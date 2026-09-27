import { randomUUID } from 'crypto';
import type { Database } from 'better-sqlite3';
import path from 'path';
import type { BackgroundJob, BackgroundJobError, BackgroundJobState, DiscoveryEvent, DiscoveredModel } from '../shared/backgroundJobs';
import type { IndexBatchResult, IndexInput } from '../shared/libraryQuery';
import type { ScanProgressData } from '../shared/types';
import { createFileIndexRepository, subscribeToFileIndexMutations, type FileIndexRepository } from './fileIndexing';
import { extractMetadata, type MetadataSummary } from './metadata';
import { filterContainedPaths } from './pathContainment';
import { pruneScanSnapshotPaths, captureScanPruneSnapshot } from './scanPruner';
import { streamDiscoverFolder } from './scanner';
import type { ScanScope, ScanTerminalState } from './scanCoverage';

export interface ScanJobResult {
  jobId: string;
  totalFiles: number;
  state: ScanTerminalState;
  affectedScopes: string[];
  errors: Array<{ scopePath: string; phase: string; reason: string }>;
  retainedCount: number;
  deletedCount: number;
  discovered: number;
  indexed: number;
  metadataCompleted: number;
  metadataFailed: number;
}

export interface ScanServiceOptions {
  db: Database;
  repository?: FileIndexRepository;
  discover?: (rootPath: string, signal: AbortSignal, generation: number) => AsyncIterable<DiscoveryEvent>;
  extractMetadata?: (filePath: string, extension: string) => Promise<MetadataSummary>;
  onProgress?: (progress: ScanProgressData) => void;
  onFileIndexed?: (path: string, current: number, total: number | null, jobId: string) => void;
  onJobChanged?: (job: BackgroundJob) => void;
  onThrottle?: (queuedDiscoveryEvents: number, queuedMetadata: number) => void;
}

export interface ScanRequestOptions { batchSize?: number; }

interface ActiveJob {
  jobId: string;
  rootPath: string;
  generation: number;
  controller: AbortController;
  state: BackgroundJobState;
  counts: BackgroundJob['counts'] & { metadataCompleted: number; metadataFailed: number };
  errors: BackgroundJobError[];
  startedAt: number;
  updatedAt: number;
  lastPublishedAt: number;
  promise: Promise<ScanJobResult>;
}

type DiscoveredRecord = DiscoveredModel;

class BoundedAsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(result: IteratorResult<T>) => void> = [];
  private readonly writers: Array<() => void> = [];
  private closed = false;
  constructor(private readonly capacity: number) {}
  get size() { return this.values.length; }
  async push(value: T): Promise<boolean> {
    while (!this.closed && this.values.length >= this.capacity) await new Promise<void>((resolve) => this.writers.push(resolve));
    if (this.closed) return false;
    const reader = this.readers.shift();
    if (reader) reader({ value, done: false }); else this.values.push(value);
    return true;
  }
  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      this.writers.shift()?.();
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.readers.push(resolve));
  }
  close(discard = false) {
    if (this.closed) return;
    this.closed = true;
    if (discard) this.values.length = 0;
    for (const reader of this.readers.splice(0)) reader({ value: undefined, done: true });
    for (const writer of this.writers.splice(0)) writer();
  }
}

class BoundedMetadataQueue {
  private readonly queue: Array<{ identity: { id: number; path: string; contentRevision: number }; file: DiscoveredRecord }> = [];
  private readonly spaceWaiters: Array<() => void> = [];
  private readonly idleWaiters: Array<() => void> = [];
  private running = false;
  private stopped = false;
  constructor(
    private readonly capacity: number,
    private readonly work: (item: { identity: { id: number; path: string; contentRevision: number }; file: DiscoveredRecord }) => Promise<void>,
    private readonly onDepth: (depth: number) => void,
  ) {}
  get depth() { return this.queue.length + (this.running ? 1 : 0); }
  async enqueue(item: { identity: { id: number; path: string; contentRevision: number }; file: DiscoveredRecord }) {
    while (!this.stopped && this.depth >= this.capacity) await new Promise<void>((resolve) => this.spaceWaiters.push(resolve));
    if (this.stopped) return;
    this.queue.push(item);
    this.onDepth(this.depth);
    void this.pump();
  }
  private async pump() {
    if (this.running) return;
    const item = this.queue.shift();
    if (!item) { for (const resolve of this.idleWaiters.splice(0)) resolve(); return; }
    this.running = true;
    this.spaceWaiters.shift()?.();
    this.onDepth(this.depth);
    try { await this.work(item); }
    finally {
      this.running = false;
      this.spaceWaiters.shift()?.();
      if (this.queue.length) void this.pump();
      else for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
  drain() {
    if (this.depth === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }
  stopPending() {
    this.stopped = true;
    this.queue.length = 0;
    for (const resolve of this.spaceWaiters.splice(0)) resolve();
    if (!this.running) for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

function normalizeBatchSize(value: number | undefined) {
  const number = Math.floor(value ?? 100);
  return Math.max(1, Math.min(250, Number.isFinite(number) ? number : 100));
}

function createJobId() { return `scan-${randomUUID()}`; }

function createScope(event: Extract<DiscoveryEvent, { type: 'scope-complete' }>): ScanScope {
  return { scopePath: event.scopePath, kind: event.kind, status: 'complete' };
}

function mapScopeError(event: Extract<DiscoveryEvent, { type: 'scope-error' }>): ScanScope {
  const excluded = event.code === 'SCOPE_EXCLUDED';
  const kind = event.kind;
  const phase: ScanScope['phase'] = event.code === 'ARCHIVE_FAILED' ? 'archive'
    : event.code === 'STAT_FAILED' ? 'stat' : excluded ? 'excluded' : 'readdir';
  return { scopePath: event.scopePath, kind, status: excluded ? 'excluded' : 'error', phase, reason: event.reason };
}

export class ScanService {
  private readonly jobs = new Map<string, ActiveJob>();
  private generation = Date.now();
  private disposed = false;
  private readonly repository: FileIndexRepository;
  private readonly discover: NonNullable<ScanServiceOptions['discover']>;
  constructor(private readonly options: ScanServiceOptions) {
    this.repository = options.repository ?? createFileIndexRepository(options.db);
    this.discover = options.discover ?? ((rootPath, signal, generation) => streamDiscoverFolder(rootPath, signal, generation));
  }

  scan(rootPath: string, request: ScanRequestOptions = {}): Promise<ScanJobResult> {
    if (this.disposed) return Promise.reject(new Error('Scan service has been disposed'));
    const canonicalRoot = path.resolve(rootPath);
    const existing = this.jobs.get(canonicalRoot);
    if (existing) return existing.promise;
    const job: ActiveJob = {
      jobId: createJobId(), rootPath: canonicalRoot, generation: ++this.generation,
      controller: new AbortController(), state: 'queued',
      counts: { discovered: 0, indexed: 0, indexFailed: 0, thumbnailsSucceeded: 0, thumbnailsFailed: 0, thumbnailsPending: 0,
        metadataCompleted: 0, metadataFailed: 0 },
      errors: [], startedAt: Date.now(), updatedAt: Date.now(), lastPublishedAt: 0,
      promise: Promise.resolve(null as unknown as ScanJobResult),
    };
    const blockers = [...this.jobs.values()].filter((active) =>
      path.resolve(active.rootPath) !== canonicalRoot &&
      (filterContainedPaths(active.rootPath, [canonicalRoot]).length > 0 || filterContainedPaths(canonicalRoot, [active.rootPath]).length > 0));
    let onAbort!: () => void;
    const readyOrCancelled = new Promise<boolean>((resolve) => {
      onAbort = () => resolve(false);
      if (job.controller.signal.aborted) resolve(false);
      else job.controller.signal.addEventListener('abort', onAbort, { once: true });
      void Promise.all(blockers.map((active) => active.promise.catch(() => undefined))).then(() => resolve(true));
    });
    job.promise = readyOrCancelled
      .then((ready) => {
        job.controller.signal.removeEventListener('abort', onAbort);
        if (!ready) {
          job.state = 'cancelled';
          this.bump(job, true);
          return {
            jobId: job.jobId, totalFiles: 0, state: 'cancelled' as const, affectedScopes: [], errors: [],
            retainedCount: 0, deletedCount: 0, discovered: 0, indexed: 0, metadataCompleted: 0, metadataFailed: 0,
          };
        }
        return this.run(job, normalizeBatchSize(request.batchSize));
      })
      .finally(() => { if (this.jobs.get(canonicalRoot) === job) this.jobs.delete(canonicalRoot); });
    this.jobs.set(canonicalRoot, job);
    this.publish(job);
    return job.promise;
  }

  cancel(jobId: string) {
    const job = [...this.jobs.values()].find((active) => active.jobId === jobId);
    if (!job || ['completed', 'partial', 'failed', 'cancelled'].includes(job.state)) return false;
    job.state = 'cancelling'; job.updatedAt = Date.now(); job.controller.abort(); this.publish(job); return true;
  }

  getBackgroundJobs(): BackgroundJob[] { return [...this.jobs.values()].map((job) => this.snapshot(job)); }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.promise.catch(() => undefined)));
  }

  private snapshot(job: ActiveJob): BackgroundJob {
    return {
      jobId: job.jobId, kind: 'scan', rootPath: job.rootPath, scopePath: job.rootPath,
      state: job.state, counts: { ...job.counts }, errors: [...job.errors],
      startedAt: job.startedAt, updatedAt: job.updatedAt,
    };
  }

  private publish(job: ActiveJob) {
    job.lastPublishedAt = Date.now();
    this.options.onJobChanged?.(this.snapshot(job));
  }

  private async run(job: ActiveJob, batchSize: number): Promise<ScanJobResult> {
    job.state = 'running'; job.updatedAt = Date.now(); this.publish(job);
    const rootPath = job.rootPath;
    const discoveredPaths = new Set<string>();
    const scopes: ScanScope[] = [];
    const errors: ScanJobResult['errors'] = [];
    const dirtyPaths = new Set<string>();
    let ownedWrite = false;
    const unsubscribe = subscribeToFileIndexMutations(this.options.db, (mutation) => {
      if (ownedWrite || !mutation.rowsChanged) return;
      for (const filePath of filterContainedPaths(rootPath, mutation.affectedPaths)) dirtyPaths.add(filePath);
    });
    const snapshot = captureScanPruneSnapshot(this.options.db, rootPath);
    const snapshotByPath = new Map(snapshot.map((row) => [row.path, row]));
    const discoveryQueue = new BoundedAsyncQueue<DiscoveryEvent>(batchSize);
    const metadataQueue = new BoundedMetadataQueue(batchSize * 2, async ({ identity, file }) => {
      if (job.controller.signal.aborted) return;
      try {
        const metadata = await (this.options.extractMetadata ?? extractMetadata)(file.path, file.extension);
        if (job.controller.signal.aborted) return;
        ownedWrite = true;
        try {
          const result = this.repository.applyMetadataResult({
            fileId: identity.id, path: identity.path, expectedContentRevision: identity.contentRevision,
            vertexCount: metadata.vertexCount, faceCount: metadata.faceCount,
            dimensions: metadata.dimensions ? JSON.stringify(metadata.dimensions) : null,
          });
          if (result.status === 'updated') { job.counts.metadataCompleted++; this.bump(job); }
        } finally { ownedWrite = false; }
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        job.counts.metadataFailed++;
        if (errors.length < 100) errors.push({ scopePath: file.path, phase: 'metadata', reason });
        if (job.errors.length < 100) job.errors.push({ path: file.path, phase: 'metadata', code: 'METADATA_FAILED',
          message: reason, retryable: true });
        this.bump(job);
      }
    }, (depth) => this.options.onThrottle?.(discoveryQueue.size, depth));

    const producer = (async () => {
      try {
        for await (const event of this.discover(rootPath, job.controller.signal, job.generation)) {
          if (job.controller.signal.aborted || !(await discoveryQueue.push(event))) break;
        }
      } catch (error: unknown) {
        if (!job.controller.signal.aborted) {
          const reason = error instanceof Error ? error.message : String(error);
          const event: DiscoveryEvent = { type: 'scope-error', rootPath, scopePath: rootPath, phase: 'discovery', code: 'DISCOVERY_FAILED', reason, kind: 'directory' };
          await discoveryQueue.push(event);
          await discoveryQueue.push({ type: 'discovery-complete', rootPath, cancelled: false });
        }
      } finally { discoveryQueue.close(job.controller.signal.aborted); }
    })();

    let pending: DiscoveredRecord[] = [];
    let pendingSince = 0;
    let discoveryComplete = false;
    let discoveryCancelled = false;
    let lastProgressAt = 0;
    let firstBatchPublished = false;
    let lastFileName = '';
    const publishProgress = (boundary = false, lastPath?: string) => {
      const now = Date.now();
      if (!boundary && now - lastProgressAt < 250) return;
      lastProgressAt = now;
      const progress: ScanProgressData = {
        current: job.counts.indexed,
        total: discoveryComplete ? job.counts.discovered : null,
        filename: lastFileName,
        skipped: false,
        jobId: job.jobId,
        discovered: job.counts.discovered,
        indexed: job.counts.indexed,
      };
      this.options.onProgress?.(progress);
      if (lastPath) this.options.onFileIndexed?.(lastPath, job.counts.indexed, progress.total, job.jobId);
    };

    const flush = async (terminal = false) => {
      if (!pending.length || job.controller.signal.aborted) { pending = []; pendingSince = 0; return; }
      const batchFiles = pending;
      pending = []; pendingSince = 0;
      const records: IndexInput[] = [];
      const fileByPath = new Map<string, DiscoveredRecord>();
      for (const file of batchFiles) {
        if (dirtyPaths.has(file.path)) continue;
        if (fileByPath.has(file.path)) continue;
        fileByPath.set(file.path, file);
        const starting = snapshotByPath.get(file.path);
        records.push({
          path: file.path, name: file.name, extension: file.extension, directory: file.directory,
          archivePath: file.archivePath, sizeBytes: file.sizeBytes, modifiedAt: file.modifiedAt,
          scanGeneration: job.generation, expectedContentRevision: starting?.content_revision ?? 0,
        });
      }
      let result: IndexBatchResult = { inserted: 0, updated: 0, unchanged: 0,
        browseRevision: this.repository.getBrowseRevision(), committed: [] };
      if (records.length) {
        ownedWrite = true;
        try { result = this.repository.applyIndexBatch({ scanGeneration: job.generation, records }); }
        finally { ownedWrite = false; }
      }
      const committedByPath = new Map(result.committed.map((identity) => [identity.path, identity]));
      job.counts.indexed += committedByPath.size;
      for (const [filePath, identity] of committedByPath) {
        const file = fileByPath.get(filePath)!;
        const starting = snapshotByPath.get(filePath);
        const contentChanged = !starting || starting.modified_at !== file.modifiedAt || starting.size_bytes !== file.sizeBytes;
        if (contentChanged) await metadataQueue.enqueue({ identity, file });
      }
      const lastCommitted = result.committed[result.committed.length - 1]?.path;
      const boundary = !firstBatchPublished || terminal;
      this.bump(job, boundary);
      if (result.committed.length || boundary) {
        firstBatchPublished ||= result.committed.length > 0;
        const pathForEvent = lastCommitted ?? batchFiles[batchFiles.length - 1]?.path;
        publishProgress(boundary, pathForEvent);
      }
      if (records.length) await new Promise<void>((resolve) => setImmediate(resolve));
    };

    let next = discoveryQueue.next();
    try {
      while (true) {
        let timer: NodeJS.Timeout | undefined;
        let outcome: { kind: 'event'; result: IteratorResult<DiscoveryEvent> } | { kind: 'timeout' };
        if (pending.length && pendingSince > 0) {
          const waitMs = Math.max(0, 50 - (Date.now() - pendingSince));
          const timed = new Promise<{ kind: 'timeout' }>((resolve) => { timer = setTimeout(() => resolve({ kind: 'timeout' }), waitMs); });
          outcome = await Promise.race([next.then((result) => ({ kind: 'event' as const, result })), timed]);
        } else {
          outcome = { kind: 'event', result: await next };
        }
        if (timer) clearTimeout(timer);
        if (outcome.kind === 'timeout') { await flush(); continue; }
        if (outcome.result.done) break;
        const event = outcome.result.value;
        next = discoveryQueue.next();
        if (event.type === 'file') {
          job.counts.discovered++;
          discoveredPaths.add(event.file.path);
          lastFileName = event.file.name;
          pending.push(event.file);
          pendingSince ||= Date.now();
          if (pending.length >= batchSize) await flush();
        } else if (event.type === 'scope-complete') {
          scopes.push(createScope(event));
          await flush();
        } else if (event.type === 'scope-error') {
          const scope = mapScopeError(event);
          scopes.push(scope);
          if (scope.status === 'error') {
            const reason = scope.reason ?? event.reason;
            const phase = scope.phase ?? 'discovery';
            if (errors.length < 100) errors.push({ scopePath: scope.scopePath, phase, reason });
            if (job.errors.length < 100) job.errors.push({ path: scope.scopePath, phase: 'discovery', code: event.code,
              message: reason, retryable: true });
          }
        } else {
          discoveryComplete = true;
          discoveryCancelled = event.cancelled;
          if (!event.cancelled) await flush(true); else pending = [];
          break;
        }
      }
      await producer;
      if (job.controller.signal.aborted) discoveryCancelled = true;
      if (!discoveryComplete && !discoveryCancelled) {
        const reason = 'Discovery stream ended without a terminal event';
        if (errors.length < 100) errors.push({ scopePath: rootPath, phase: 'discovery', reason });
        if (job.errors.length < 100) job.errors.push({ path: rootPath, phase: 'discovery', code: 'MISSING_TERMINAL_EVENT', message: reason, retryable: true });
      }
      if (discoveryCancelled) metadataQueue.stopPending();
      await metadataQueue.drain();
      const state: ScanTerminalState = discoveryCancelled ? 'cancelled'
        : errors.length || scopes.some((scope) => scope.status !== 'complete') || job.counts.metadataFailed
          ? scopes.some((scope) => scope.status === 'complete') ? 'partial' : 'failed'
          : 'completed';
      const pruneResult = discoveryCancelled ? { deletedCount: 0, retainedCount: snapshot.length }
        : pruneScanSnapshotPaths(this.options.db, rootPath, { scopes, state }, discoveredPaths, snapshot);
      const affectedScopes = scopes.filter((scope) => scope.status !== 'complete').map((scope) => scope.scopePath);
      job.state = state;
      this.bump(job, true);
      publishProgress(true);
      const result: ScanJobResult = {
        jobId: job.jobId, totalFiles: job.counts.discovered, state, affectedScopes, errors,
        retainedCount: pruneResult.retainedCount, deletedCount: pruneResult.deletedCount,
        discovered: job.counts.discovered, indexed: job.counts.indexed,
        metadataCompleted: job.counts.metadataCompleted, metadataFailed: job.counts.metadataFailed,
      };
      return result;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      const wasCancelled = job.controller.signal.aborted;
      job.state = wasCancelled ? 'cancelled' : 'failed';
      if (!wasCancelled && job.errors.length < 100) job.errors.push({
        path: rootPath, phase: 'indexing', code: 'SCAN_FAILED', message: reason, retryable: true,
      });
      job.controller.abort(); discoveryQueue.close(true); metadataQueue.stopPending();
      await producer.catch(() => undefined);
      await metadataQueue.drain();
      this.bump(job, true);
      return {
        jobId: job.jobId, totalFiles: job.counts.discovered,
        state: wasCancelled ? 'cancelled' : 'failed',
        affectedScopes: scopes.filter((scope) => scope.status !== 'complete').map((scope) => scope.scopePath),
        errors: [...errors, ...(!wasCancelled ? [{ scopePath: rootPath, phase: 'indexing', reason }] : [])],
        retainedCount: snapshot.length, deletedCount: 0,
        discovered: job.counts.discovered, indexed: job.counts.indexed,
        metadataCompleted: job.counts.metadataCompleted, metadataFailed: job.counts.metadataFailed,
      };
    } finally {
      unsubscribe();
      discoveryQueue.close(true);
      metadataQueue.stopPending();
    }
  }

  private bump(job: ActiveJob, boundary = false) {
    const now = Date.now();
    job.updatedAt = now;
    if (boundary || now - job.lastPublishedAt >= 250) this.publish(job);
  }
}

export function createScanService(options: ScanServiceOptions) { return new ScanService(options); }
