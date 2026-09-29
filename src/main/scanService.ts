import { randomUUID } from 'crypto';
import fs from 'fs';
import type { Database } from 'better-sqlite3';
import path from 'path';
import type { BackgroundJob, BackgroundJobError, BackgroundJobState, DiscoveryEvent, DiscoveredModel } from '../shared/backgroundJobs';
import type { IndexBatchResult, IndexInput } from '../shared/libraryQuery';
import type { ScanProgressData } from '../shared/types';
import { createFileIndexRepository, subscribeToFileIndexMutations, type FileIndexRepository } from './fileIndexing';
import { extractMetadata, type MetadataSummary } from './metadata';
import { filterContainedPaths } from './pathContainment';
import { pruneScanSnapshotPaths, captureScanPruneSnapshot } from './scanPruner';
import { streamDiscoverArchive, streamDiscoverFolder } from './scanner';
import { ARCHIVE_ENTRY_SEPARATOR } from '../shared/archivePaths';
import type { ScanScope, ScanTerminalState } from './scanCoverage';
import { hasCurrentStoredMeasurement } from '../shared/model/measurement';

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
  extractMetadata?: (filePath: string, extension: string, context: { identity: { id: number; path: string; contentRevision: number }; requestId: string; signal: AbortSignal }) => Promise<MetadataSummary>;
  onProgress?: (progress: ScanProgressData) => void;
  onFileIndexed?: (path: string, current: number, total: number | null, jobId: string) => void;
  onJobChanged?: (job: BackgroundJob) => void;
  onThrottle?: (queuedDiscoveryEvents: number, queuedMetadata: number) => void;
}

export interface ScanRequestOptions { batchSize?: number; signal?: AbortSignal; }

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
  pauseRequested: boolean;
  resumeWait: Promise<void>;
  releaseResume: () => void;
  pauseAcknowledged: Promise<void>;
  acknowledgePause: () => void;
  retryController?: AbortController;
  retryPromise?: Promise<boolean>;
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

function startIsolatedScanHeartbeatProbe(): () => void {
  const outputPath = process.env.POLYTRAY_SCAN_TEST_HEARTBEAT_PATH;
  const scratchDir = process.env.POLYTRAY_PERF_SCRATCH;
  if (process.env.POLYTRAY_ISOLATED_TEST !== '1' || !outputPath || !path.isAbsolute(outputPath)
    || !scratchDir || !filterContainedPaths(scratchDir, [outputPath]).length) return () => {};
  const intervalMs = 25;
  const gapsMs: number[] = [];
  let previous = performance.now();
  const recordGap = () => {
    const now = performance.now();
    gapsMs.push(now - previous);
    previous = now;
  };
  const timer = setInterval(recordGap, intervalMs);
  return () => {
    // Include the final interval through scan completion; otherwise a stall
    // that ends the scan before the next timer tick would be omitted.
    recordGap();
    clearInterval(timer);
    const result = {
      intervalMs,
      samples: gapsMs.length,
      maxGapMs: gapsMs.length ? Math.max(...gapsMs) : null,
      gapsMs,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result));
  };
}

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
  private readonly recentJobs: BackgroundJob[] = [];
  private readonly terminalJobRecords = new Map<string, ActiveJob>();
  private readonly jobListeners = new Set<(job: BackgroundJob) => void>();
  private readonly retryOperations = new Set<Promise<boolean>>();
  private readonly retryControllers = new Set<AbortController>();
  private disposePromise?: Promise<void>;
  private generation = Date.now();
  private disposed = false;
  private readonly repository: FileIndexRepository;
  private readonly discover: NonNullable<ScanServiceOptions['discover']>;
  constructor(private readonly options: ScanServiceOptions) {
    this.repository = options.repository ?? createFileIndexRepository(options.db);
    this.discover = options.discover ?? ((rootPath, signal, generation) => rootPath.endsWith(ARCHIVE_ENTRY_SEPARATOR)
      ? streamDiscoverArchive(rootPath.slice(0, -ARCHIVE_ENTRY_SEPARATOR.length), rootPath, signal, generation)
      : streamDiscoverFolder(rootPath, signal, generation));
  }

  scan(rootPath: string, request: ScanRequestOptions = {}): Promise<ScanJobResult> {
    if (this.disposed) return Promise.reject(new Error('Scan service has been disposed'));
    const canonicalRoot = path.resolve(rootPath);
    const existing = this.jobs.get(canonicalRoot);
    if (existing) {
      if (!request.signal) return existing.promise;
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('Scan wait cancelled'));
      return new Promise<ScanJobResult>((resolve, reject) => {
        let settled = false;
        const cleanup = () => request.signal?.removeEventListener('abort', onAbort);
        const settle = (result: ScanJobResult) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(request.signal?.reason ?? new Error('Scan wait cancelled'));
        };
        request.signal!.addEventListener('abort', onAbort, { once: true });
        existing.promise.then(settle, (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        });
        if (request.signal?.aborted) onAbort();
      });
    }
    let releaseResume!: () => void;
    let acknowledgePause!: () => void;
    const job: ActiveJob = {
      jobId: createJobId(), rootPath: canonicalRoot, generation: ++this.generation,
      controller: new AbortController(), state: 'queued',
      counts: { discovered: 0, indexed: 0, indexFailed: 0, thumbnailsSucceeded: 0, thumbnailsFailed: 0, thumbnailsPending: 0,
        metadataCompleted: 0, metadataFailed: 0 },
      errors: [], startedAt: Date.now(), updatedAt: Date.now(), lastPublishedAt: 0,
      promise: Promise.resolve(null as unknown as ScanJobResult),
      pauseRequested: false,
      resumeWait: new Promise<void>((resolve) => { releaseResume = resolve; }),
      releaseResume: () => releaseResume(),
      pauseAcknowledged: Promise.resolve(),
      acknowledgePause: () => acknowledgePause(),
    };
    job.pauseAcknowledged = new Promise<void>((resolve) => { acknowledgePause = resolve; });
    const abortFromParent = () => job.controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abortFromParent();
    else request.signal?.addEventListener('abort', abortFromParent, { once: true });
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
      .finally(() => {
        request.signal?.removeEventListener('abort', abortFromParent);
        if (this.jobs.get(canonicalRoot) === job) this.jobs.delete(canonicalRoot);
      });
    this.jobs.set(canonicalRoot, job);
    this.publish(job);
    return job.promise;
  }

  cancel(jobId: string) {
    const job = [...this.jobs.values()].find((active) => active.jobId === jobId) ?? this.terminalJobRecords.get(jobId);
    if (!job || (['completed', 'partial', 'failed', 'cancelled'].includes(job.state) && !job.retryPromise)) return false;
    job.state = 'cancelling'; job.updatedAt = Date.now(); job.controller.abort(); job.retryController?.abort();
    job.releaseResume();
    job.acknowledgePause();
    this.publish(job);
    return true;
  }

  async pause(jobId: string): Promise<boolean> {
    const job = [...this.jobs.values()].find((active) => active.jobId === jobId);
    if (job?.state === 'pausing') {
      await job.pauseAcknowledged;
      return (job.state as BackgroundJobState) === 'paused';
    }
    if (!job || !['queued', 'running'].includes(job.state)) return false;
    job.pauseRequested = true;
    job.state = 'pausing';
    job.pauseAcknowledged = new Promise<void>((resolve) => { job.acknowledgePause = resolve; });
    this.publish(job);
    await job.pauseAcknowledged;
    return (job.state as BackgroundJobState) === 'paused';
  }

  resume(jobId: string) {
    const job = [...this.jobs.values()].find((active) => active.jobId === jobId);
    if (!job || job.state !== 'paused') return false;
    job.pauseRequested = false;
    job.state = 'running';
    job.updatedAt = Date.now();
    this.publish(job);
    job.releaseResume();
    job.resumeWait = new Promise<void>((resolve) => { job.releaseResume = resolve; });
    return true;
  }

  retryFailures(jobId: string) {
    if (this.disposed) return Promise.resolve(false);
    const job = this.terminalJobRecords.get(jobId);
    if (!job || !['partial', 'failed'].includes(job.state) || job.retryPromise) return Promise.resolve(false);
    const retryable = job.errors.filter((error) => error.retryable);
    if (!retryable.length) return Promise.resolve(false);
    const retryController = new AbortController();
    job.retryController = retryController;
    this.retryControllers.add(retryController);
    let operation!: Promise<boolean>;
    operation = Promise.resolve()
      .then(() => this.runRetryFailures(job, retryable, retryController))
      .finally(() => {
        if (job.retryPromise === operation) job.retryPromise = undefined;
        if (job.retryController === retryController) job.retryController = undefined;
        this.retryOperations.delete(operation);
        this.retryControllers.delete(retryController);
      });
    job.retryPromise = operation;
    this.retryOperations.add(operation);
    return operation;
  }

  private async runRetryFailures(job: ActiveJob, retryable: BackgroundJobError[], retryController: AbortController) {
    await job.promise.catch(() => undefined);
    if (retryController.signal.aborted || this.disposed) {
      job.state = 'cancelled';
      this.bump(job, true);
      return true;
    }
    job.state = 'running';
    this.publish(job);
    for (const error of retryable) {
      if (retryController.signal.aborted) break;
      if (!error.path) continue;
      if (error.phase === 'metadata') {
        const identity = this.repository.getFileIdentityByPath(error.path);
        if (!identity) continue;
        try {
          const extension = path.extname(identity.path).slice(1).toLowerCase();
          const extract = this.options.extractMetadata ?? ((filePath, fileExtension, context) =>
            extractMetadata(filePath, fileExtension, { signal: context.signal }));
          const metadata = await extract(identity.path, extension, { identity, requestId: randomUUID(), signal: retryController.signal });
          if (retryController.signal.aborted) break;
          const result = this.repository.applyMetadataResult({ fileId: identity.id, path: identity.path,
            expectedContentRevision: identity.contentRevision, vertexCount: metadata.vertexCount,
            faceCount: metadata.faceCount, dimensions: metadata.dimensions ? JSON.stringify(metadata.dimensions) : null });
          if (result.status === 'updated') {
            job.counts.metadataCompleted++;
            job.counts.metadataFailed = Math.max(0, job.counts.metadataFailed - 1);
            job.errors = job.errors.filter((item) => !(item.path === error.path && item.phase === error.phase && item.code === error.code));
          }
        } catch (cause) {
          if (retryController.signal.aborted) break;
          error.message = cause instanceof Error ? cause.message : String(cause);
        }
      } else if (error.phase === 'discovery') {
        const retryRoot = error.code === 'ARCHIVE_FAILED' ? `${error.path}${ARCHIVE_ENTRY_SEPARATOR}` : error.path;
        const scopeRetry = await this.scan(retryRoot, { signal: retryController.signal }).catch(() => null);
        if (retryController.signal.aborted) break;
        if (scopeRetry?.state === 'completed') {
          job.errors = job.errors.filter((item) => !(item.path === error.path && item.phase === error.phase && item.code === error.code));
        }
      }
    }
    job.state = retryController.signal.aborted || this.disposed ? 'cancelled' : job.errors.some((error) => error.retryable) ? 'partial' : 'completed';
    this.bump(job, true);
    return true;
  }

  onJobChanged(callback: (job: BackgroundJob) => void) {
    this.jobListeners.add(callback);
    return () => this.jobListeners.delete(callback);
  }

  getBackgroundJobs(): BackgroundJob[] {
    const jobs = new Map(this.recentJobs.map((job) => [job.jobId, job]));
    for (const job of this.jobs.values()) jobs.set(job.jobId, this.snapshot(job));
    return [...jobs.values()];
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    for (const job of this.jobs.values()) { job.controller.abort(); job.releaseResume(); }
    for (const controller of this.retryControllers) controller.abort();
    this.disposePromise = Promise.all([
      ...[...this.jobs.values()].map((job) => job.promise.catch(() => undefined)),
      ...this.retryOperations,
    ]).then(() => { this.jobListeners.clear(); });
    return this.disposePromise;
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
    const snapshot = this.snapshot(job);
    if (['completed', 'partial', 'failed', 'cancelled'].includes(job.state)) {
      if (job.pauseRequested) {
        job.pauseRequested = false;
        job.acknowledgePause();
      }
      this.terminalJobRecords.set(job.jobId, job);
      const prior = this.recentJobs.findIndex((item) => item.jobId === job.jobId);
      if (prior >= 0) this.recentJobs.splice(prior, 1);
      this.recentJobs.unshift(snapshot);
      this.recentJobs.splice(20);
      for (const oldId of this.terminalJobRecords.keys()) if (!this.recentJobs.some((item) => item.jobId === oldId)) this.terminalJobRecords.delete(oldId);
    } else {
      const prior = this.recentJobs.findIndex((item) => item.jobId === job.jobId);
      if (prior >= 0) this.recentJobs[prior] = snapshot;
    }
    this.options.onJobChanged?.(snapshot);
    for (const listener of this.jobListeners) listener(snapshot);
  }

  private async run(job: ActiveJob, batchSize: number): Promise<ScanJobResult> {
    job.state = 'running'; job.updatedAt = Date.now(); this.publish(job);
    if (job.pauseRequested && !job.controller.signal.aborted) {
      job.state = 'paused';
      this.publish(job);
      job.acknowledgePause();
      await job.resumeWait;
      if (job.controller.signal.aborted) {
        job.state = 'cancelled';
        this.bump(job, true);
        return { jobId: job.jobId, totalFiles: 0, state: 'cancelled', affectedScopes: [], errors: [], retainedCount: 0,
          deletedCount: 0, discovered: 0, indexed: 0, metadataCompleted: 0, metadataFailed: 0 };
      }
      job.state = 'running';
      this.publish(job);
    }
    let stopHeartbeatProbe = () => {};
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
        const requestId = randomUUID();
        const extract = this.options.extractMetadata ?? ((filePath, extension, context) =>
          extractMetadata(filePath, extension, { signal: context.signal }));
        const metadata = await extract(file.path, file.extension, {
          identity, requestId, signal: job.controller.signal,
        });
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
        if (job.controller.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        job.counts.metadataFailed++;
        if (errors.length < 100) errors.push({ scopePath: file.path, phase: 'metadata', reason });
        if (job.errors.length < 100) job.errors.push({ path: file.path, phase: 'metadata', code: 'METADATA_FAILED',
          message: reason, retryable: true });
        this.bump(job);
      }
    }, (depth) => this.options.onThrottle?.(discoveryQueue.size, depth));

    const producer = (async () => {
      let iterator: AsyncIterator<DiscoveryEvent> | undefined;
      try {
        iterator = this.discover(rootPath, job.controller.signal, job.generation)[Symbol.asyncIterator]();
        while (!job.controller.signal.aborted) {
          if (job.pauseRequested) await job.resumeWait;
          const item = await iterator.next();
          if (item.done) break;
          const event = item.value;
          if (job.controller.signal.aborted || !(await discoveryQueue.push(event))) break;
        }
      } catch (error: unknown) {
        if (!job.controller.signal.aborted) {
          const reason = error instanceof Error ? error.message : String(error);
          const event: DiscoveryEvent = { type: 'scope-error', rootPath, scopePath: rootPath, phase: 'discovery', code: 'DISCOVERY_FAILED', reason, kind: 'directory' };
          await discoveryQueue.push(event);
          await discoveryQueue.push({ type: 'discovery-complete', rootPath, cancelled: false });
        }
      } finally {
        await iterator?.return?.();
        discoveryQueue.close(job.controller.signal.aborted);
      }
    })();
    stopHeartbeatProbe = startIsolatedScanHeartbeatProbe();

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
        if (contentChanged || !hasCurrentStoredMeasurement(starting?.dimensions)) {
          await metadataQueue.enqueue({ identity, file });
        }
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
        if (job.pauseRequested && !job.controller.signal.aborted) {
          await metadataQueue.drain();
          if (!job.controller.signal.aborted) {
            job.state = 'paused';
            job.updatedAt = Date.now();
            this.publish(job);
            job.acknowledgePause();
            await job.resumeWait;
            if (!job.controller.signal.aborted) { job.state = 'running'; this.bump(job, true); }
          }
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
      stopHeartbeatProbe();
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
