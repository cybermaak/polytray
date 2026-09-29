import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createDbAtVersion } from '../../../support/helpers/databaseFixtures';
import { createBarrier } from '../../../support/helpers/performanceProbe';
import { createFileIndexRepository, subscribeToFileIndexMutations } from '../../../../src/main/fileIndexing';
import { createScanService } from '../../../../src/main/scanService';
import { ScanJobsController } from '../../../../src/main/scanJobs';
import { MetadataWorkerClient, type MetadataWorkerRequest } from '../../../../src/main/metadataWorkerClient';
import type { DiscoveryEvent } from '../../../../src/shared/backgroundJobs';
import type { ScanProgressData } from '../../../../src/shared/types';
import { streamDiscoverFolder } from '../../../../src/main/scanner';
import { createAvailableMeasurement } from '../../../../src/shared/model/measurement';

function createTestDb() {
  const fixture = createDbAtVersion(5);
  const db = new Database(fixture.dbPath);
  db.pragma('foreign_keys = ON');
  return { db, cleanup: () => { db.close(); fs.rmSync(fixture.dir, { recursive: true, force: true }); } };
}

function discovered(rootPath: string, filePath: string): DiscoveryEvent {
  return {
    type: 'file', rootPath, scopePath: path.dirname(filePath),
    file: {
      path: filePath, directory: path.dirname(filePath), archivePath: null,
      name: path.basename(filePath, '.stl'), extension: 'stl', sizeBytes: 10, modifiedAt: 20,
    },
  };
}

test('commits a completed subtree while discovery of a later subtree is blocked', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-stream-'));
  const firstPath = path.join(rootPath, 'first', 'one.stl');
  const secondPath = path.join(rootPath, 'second', 'two.stl');
  const laterSubtree = createBarrier<void>();
  const firstCommitted = createBarrier<void>();
  const metadataStarted = createBarrier<void>();
  const metadataRelease = createBarrier<void>();
  const progress: ScanProgressData[] = [];
  const queueDepths: number[] = [];
  const unsubscribe = subscribeToFileIndexMutations(fixture.db, (mutation) => {
    if (mutation.affectedPaths.includes(firstPath)) firstCommitted.release();
  });
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, signal, generation): AsyncGenerator<DiscoveryEvent> {
      yield discovered(rootPath, firstPath);
      yield { type: 'scope-complete', rootPath, scopePath: path.dirname(firstPath), generation, kind: 'directory' };
      await laterSubtree.wait(signal);
      yield discovered(rootPath, secondPath);
      yield { type: 'scope-complete', rootPath, scopePath: path.dirname(secondPath), generation, kind: 'directory' };
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => {
      metadataStarted.release();
      await metadataRelease.wait();
      return { vertexCount: 12, faceCount: 4, dimensions: { x: 1, y: 2, z: 3 } };
    },
    onProgress: (item) => progress.push(item),
    onThrottle: (queuedDiscovery, queuedMetadata) => queueDepths.push(queuedDiscovery + queuedMetadata),
  });

  try {
    const scan = service.scan(rootPath, { batchSize: 2 });
    await laterSubtree.reached;
    await firstCommitted.wait();
    await metadataStarted.wait();
    const firstRow = fixture.db.prepare('SELECT path FROM files WHERE path = ?').get(firstPath);
    assert.deepEqual(firstRow, { path: firstPath });
    assert.equal((fixture.db.prepare('SELECT vertex_count FROM files WHERE path = ?').get(firstPath) as { vertex_count: number }).vertex_count, 0);
    assert.equal(fixture.db.prepare('SELECT path FROM files WHERE path = ?').get(secondPath), undefined);
    assert.equal(progress.some((item) => item.total === null && item.discovered === 1 && item.indexed === 1), true);
    assert.equal(progress.some((item) => Number.isNaN(item.total as number)), false);
    assert.equal(queueDepths.every((depth) => depth <= 6), true);

    laterSubtree.release();
    metadataRelease.release();
    const result = await scan;
    assert.equal(result.discovered, 2);
    assert.equal(result.indexed, 2);
    assert.equal(result.metadataCompleted, 2);
    assert.equal((fixture.db.prepare('SELECT vertex_count FROM files WHERE path = ?').get(firstPath) as { vertex_count: number }).vertex_count, 12);
  } finally {
    unsubscribe();
    service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('pause acknowledges after the current metadata unit and resume continues the same scan', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-pause-'));
  const firstPath = path.join(rootPath, 'first.stl');
  const secondPath = path.join(rootPath, 'second.stl');
  const firstMetadataStarted = createBarrier<void>();
  const releaseMetadata = createBarrier<void>();
  const discoveredSecond = createBarrier<void>();
  const states: string[] = [];
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation) {
      yield discovered(rootPath, firstPath);
      yield discovered(rootPath, secondPath);
      discoveredSecond.release();
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async (_path, _extension, { identity }) => {
      if (identity.path === firstPath) { firstMetadataStarted.release(); await releaseMetadata.wait(); }
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
    onJobChanged: (job) => states.push(job.state),
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 1 });
    await firstMetadataStarted.wait();
    const job = service.getBackgroundJobs().find((item) => item.rootPath === rootPath)!;
    const pause = service.pause(job.jobId);
    releaseMetadata.release();
    assert.equal(await pause, true);
    const pausedJob = service.getBackgroundJobs().find((item) => item.jobId === job.jobId)!;
    assert.equal(pausedJob.state, 'paused');
    assert.equal(pausedJob.counts.discovered, 1);
    assert.equal(pausedJob.counts.indexed, 1);
    assert.equal(fixture.db.prepare('SELECT path FROM files WHERE path = ?').get(firstPath) !== undefined, true);
    assert.equal(fixture.db.prepare('SELECT path FROM files WHERE path = ?').get(secondPath), undefined);
    assert.equal(service.resume(job.jobId), true);
    assert.equal((await scan).state, 'completed');
    for (const state of ['queued', 'running', 'pausing', 'paused', 'completed']) assert.equal(states.includes(state), true, `missing ${state}`);
    await discoveredSecond.wait();
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('cancelling a scan settles a concurrent pause request', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-pause-cancel-'));
  const filePath = path.join(rootPath, 'current.stl');
  const discoveryBlocked = createBarrier<void>();
  const indexed = createBarrier<void>();
  const unsubscribe = subscribeToFileIndexMutations(fixture.db, (mutation) => {
    if (mutation.affectedPaths.includes(filePath)) indexed.release();
  });
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, signal) {
      yield discovered(rootPath, filePath);
      await discoveryBlocked.wait(signal);
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => ({ vertexCount: 1, faceCount: 1, dimensions: null }),
  });
  const controls = new ScanJobsController({
    getJobs: () => service.getBackgroundJobs(),
    onChanged: (callback) => service.onJobChanged(callback),
    pause: async (jobId) => service.pause(jobId),
    resume: async (jobId) => service.resume(jobId),
    cancel: async (jobId) => service.cancel(jobId),
    retryFailures: async (jobId) => service.retryFailures(jobId),
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 1 });
    await indexed.wait();
    await discoveryBlocked.reached;
    const jobId = service.getBackgroundJobs().find((job) => job.rootPath === rootPath)!.jobId;
    let pauseSettled = false;
    const pause = controls.pauseJob(jobId).then((result) => { pauseSettled = true; return result; });
    const cancelCommand = controls.cancelJob(jobId);
    const cancelResult = await cancelCommand;
    const scanResult = await scan;
    await Promise.resolve();
    assert.equal(pauseSettled, true);
    const pauseResult = pauseSettled ? await pause : null;
    assert.deepEqual(pauseResult, { ok: false, reason: 'invalid-state' });
    assert.equal(cancelResult.ok, true);
    assert.equal(scanResult.state, 'cancelled');
  } finally {
    unsubscribe();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('pause requested at terminal discovery settles as invalid when the scan completes', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-pause-terminal-'));
  const filePath = path.join(rootPath, 'terminal.stl');
  const metadataStarted = createBarrier<void>();
  const releaseMetadata = createBarrier<void>();
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root) {
      yield discovered(rootPath, filePath);
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => {
      metadataStarted.release();
      await releaseMetadata.wait();
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 2 });
    await metadataStarted.wait();
    const jobId = service.getBackgroundJobs().find((job) => job.rootPath === rootPath)!.jobId;
    let pauseSettled = false;
    const pause = service.pause(jobId).then((result) => { pauseSettled = true; return result; });
    releaseMetadata.release();
    const result = await scan;
    await Promise.resolve();
    assert.equal(result.state, 'completed');
    assert.equal(pauseSettled, true);
    assert.equal(await pause, false);
  } finally {
    releaseMetadata.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('terminal jobs publish once and recent history remains bounded to twenty', async () => {
  const fixture = createTestDb();
  const roots = Array.from({ length: 21 }, () => fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-history-')));
  const terminalEvents = new Map<string, number>();
  const service = createScanService({
    db: fixture.db,
    discover: async function* (rootPath, _signal, generation) {
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    onJobChanged: (job) => {
      if (['completed', 'partial', 'failed', 'cancelled'].includes(job.state)) terminalEvents.set(job.jobId, (terminalEvents.get(job.jobId) ?? 0) + 1);
    },
  });
  try {
    for (const root of roots) await service.scan(root);
    const jobs = service.getBackgroundJobs();
    assert.equal(jobs.length, 20);
    assert.equal(terminalEvents.size, 21);
    assert.equal([...terminalEvents.values()].every((count) => count === 1), true);
    const newest = jobs[0];
    assert.equal(service.cancel(newest.jobId), false);
    assert.equal(service.resume(newest.jobId), false);
  } finally {
    await service.dispose();
    fixture.cleanup();
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retryFailures re-extracts only failed metadata files and leaves healthy files untouched', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-retry-'));
  const failedPath = path.join(rootPath, 'failed.stl');
  const healthyPath = path.join(rootPath, 'healthy.stl');
  const attempts = new Map<string, number>();
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation) {
      yield discovered(rootPath, failedPath);
      yield discovered(rootPath, healthyPath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async (filePath) => {
      const count = (attempts.get(filePath) ?? 0) + 1;
      attempts.set(filePath, count);
      if (filePath === failedPath && count === 1) throw new Error('temporary extraction failure');
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
  });
  try {
    const result = await service.scan(rootPath, { batchSize: 2 });
    assert.equal(result.state, 'partial');
    assert.equal(await service.retryFailures(result.jobId), true);
    assert.deepEqual([...attempts.entries()].sort(), [[failedPath, 2], [healthyPath, 1]]);
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === result.jobId)?.state, 'completed');
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('retry admission is atomic and can be cancelled before it starts extraction', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-retry-admission-'));
  const failedPath = path.join(rootPath, 'failed.stl');
  let attempts = 0;
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation) {
      yield discovered(rootPath, failedPath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => {
      attempts++;
      if (attempts === 1) throw new Error('initial failure');
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
  });
  try {
    const initial = await service.scan(rootPath, { batchSize: 1 });
    assert.equal(initial.state, 'partial');
    const first = service.retryFailures(initial.jobId);
    const duplicate = service.retryFailures(initial.jobId);
    const cancelAccepted = service.cancel(initial.jobId);
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    assert.equal(cancelAccepted, true);
    assert.equal(firstResult, true);
    assert.equal(duplicateResult, false);
    assert.equal(attempts, 1);
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === initial.jobId)?.state, 'cancelled');
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('dispose aborts and awaits a held metadata retry before returning', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-retry-dispose-'));
  const filePath = path.join(rootPath, 'retry.stl');
  const retryStarted = createBarrier<void>();
  const releaseRetry = createBarrier<void>();
  let retrySignal: AbortSignal | undefined;
  const states: string[] = [];
  let attempts = 0;
  const service = createScanService({
    db: fixture.db,
    onJobChanged: (job) => states.push(job.state),
    discover: async function* (_root, _signal, generation) {
      yield discovered(rootPath, filePath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async (_path, _extension, context) => {
      attempts++;
      if (attempts === 1) throw new Error('initial failure');
      retrySignal = context.signal;
      retryStarted.release();
      await releaseRetry.wait();
      return { vertexCount: 7, faceCount: 2, dimensions: null };
    },
  });
  try {
    const initial = await service.scan(rootPath, { batchSize: 1 });
    const retry = service.retryFailures(initial.jobId);
    await retryStarted.wait();
    let disposeSettled = false;
    const disposalPromise = service.dispose();
    const disposal = disposalPromise.then(() => { disposeSettled = true; });
    assert.equal(service.dispose(), disposalPromise);
    await Promise.resolve();
    assert.equal(retrySignal?.aborted, true);
    assert.equal(disposeSettled, false);
    releaseRetry.release();
    await Promise.all([disposal, retry]);
    const eventCountAfterDispose = states.length;
    await Promise.resolve();
    assert.equal(states.length, eventCountAfterDispose);
    const row = fixture.db.prepare('SELECT vertex_count, face_count FROM files WHERE path = ?').get(filePath) as { vertex_count: number; face_count: number };
    assert.deepEqual(row, { vertex_count: 0, face_count: 0 });
    assert.equal(states.at(-1), 'cancelled');
  } finally {
    releaseRetry.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('active retry remains visible and cancellable after terminal history rolls over', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-retry-retention-'));
  const filePath = path.join(rootPath, 'retry.stl');
  const retryStarted = createBarrier<void>();
  const releaseRetry = createBarrier<void>();
  let retrySignal: AbortSignal | undefined;
  let attempts = 0;
  const newerRoots = Array.from({ length: 21 }, () => fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-newer-')));
  const service = createScanService({
    db: fixture.db,
    discover: async function* (root, _signal, generation) {
      if (root === rootPath) yield discovered(rootPath, filePath);
      yield { type: 'scope-complete', rootPath: root, scopePath: root, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath: root, cancelled: false };
    },
    extractMetadata: async (_path, _extension, context) => {
      attempts++;
      if (attempts === 1) throw new Error('initial failure');
      retrySignal = context.signal;
      retryStarted.release();
      await releaseRetry.wait(context.signal);
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
  });
  try {
    const initial = await service.scan(rootPath, { batchSize: 1 });
    assert.equal(initial.state, 'partial');
    const retry = service.retryFailures(initial.jobId);
    await retryStarted.wait();
    for (const newerRoot of newerRoots) await service.scan(newerRoot);

    const visibleJobs = service.getBackgroundJobs();
    const visible = visibleJobs.find((job) => job.jobId === initial.jobId);
    assert.equal(visible?.state, 'running');
    assert.equal(visibleJobs.length, 21);
    assert.equal(visibleJobs.filter((job) => job.state === 'completed').length, 20);
    assert.equal(service.cancel(initial.jobId), true);
    assert.equal(retrySignal?.aborted, true);
    assert.equal(await retry, true);
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === initial.jobId)?.state, 'cancelled');
  } finally {
    releaseRetry.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
    for (const newerRoot of newerRoots) fs.rmSync(newerRoot, { recursive: true, force: true });
  }
});

test('retryFailures reopens only the failed archive scope and preserves healthy siblings', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-archive-retry-'));
  const archivePath = path.join(rootPath, 'broken.zip');
  const healthyPath = path.join(rootPath, 'healthy.stl');
  fs.writeFileSync(archivePath, 'broken archive');
  fs.writeFileSync(healthyPath, 'solid healthy\nendsolid healthy\n');
  let healthyMetadataRuns = 0;
  const service = createScanService({
    db: fixture.db,
    extractMetadata: async (filePath) => {
      if (filePath === healthyPath) healthyMetadataRuns++;
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
  });
  try {
    const initial = await service.scan(rootPath, { batchSize: 1 });
    assert.equal(initial.state, 'partial');
    const archive = new JSZip();
    archive.file('nested/recovered.stl', 'solid recovered\nendsolid recovered\n');
    fs.writeFileSync(archivePath, await archive.generateAsync({ type: 'nodebuffer' }));
    assert.equal(await service.retryFailures(initial.jobId), true);
    assert.equal(healthyMetadataRuns, 1);
    assert.equal(fixture.db.prepare('SELECT path FROM files WHERE path = ?').get(healthyPath) !== undefined, true);
    assert.equal(fixture.db.prepare('SELECT path FROM files WHERE path = ?').get(`${archivePath}::entry::nested/recovered.stl`) !== undefined, true);
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === initial.jobId)?.state, 'completed');
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('unchanged legacy dimensions are re-enriched without clearing annotations or thumbnail state', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-measurement-refresh-'));
  const filePath = path.join(rootPath, 'same.stl');
  const repository = createFileIndexRepository(fixture.db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: filePath, name: 'same', extension: 'stl', directory: rootPath,
    sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
  }] });
  fixture.db.prepare('UPDATE files SET dimensions = ?, tags = ?, notes = ?, thumbnail = ? WHERE path = ?')
    .run('{"x":1,"y":1,"z":1}', '["kept"]', 'keep this note', '/cache/stable.png', filePath);
  let extractions = 0;
  const measurement = createAvailableMeasurement({ x: 1, y: 1, z: 0 }, 'model-unit')!;
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation) {
      yield discovered(rootPath, filePath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => { extractions++; return { vertexCount: 3, faceCount: 1, dimensions: measurement }; },
  });
  try {
    const result = await service.scan(rootPath, { batchSize: 1 });
    const row = fixture.db.prepare('SELECT dimensions, tags, notes, thumbnail, modified_at, size_bytes FROM files WHERE path = ?').get(filePath) as Record<string, unknown>;
    assert.equal(result.state, 'completed');
    assert.equal(extractions, 1);
    assert.deepEqual(JSON.parse(row.dimensions as string), measurement);
    assert.deepEqual(row, {
      dimensions: JSON.stringify(measurement), tags: '["kept"]', notes: 'keep this note',
      thumbnail: '/cache/stable.png', modified_at: 20, size_bytes: 10,
    });
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('the elapsed-time flush keeps the pending event read and does not drop later discoveries', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-time-flush-'));
  const firstPath = path.join(rootPath, 'first.stl');
  const secondPath = path.join(rootPath, 'second.stl');
  const held = createBarrier<void>();
  const release = createBarrier<void>();
  const firstCommitted = createBarrier<void>();
  const unsubscribe = subscribeToFileIndexMutations(fixture.db, (mutation) => {
    if (mutation.affectedPaths.includes(firstPath)) firstCommitted.release();
  });
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, signal, generation): AsyncGenerator<DiscoveryEvent> {
      yield discovered(rootPath, firstPath);
      held.release();
      await release.wait(signal);
      yield discovered(rootPath, secondPath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => ({ vertexCount: 0, faceCount: 0, dimensions: null }),
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 2 });
    await held.wait();
    await firstCommitted.wait();
    release.release();
    const result = await scan;
    assert.equal(result.discovered, 2);
    assert.equal(result.indexed, 2);
    assert.equal(result.state, 'completed');
  } finally {
    unsubscribe();
    release.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('streams file and scope proof events, and cancellation never completes an open scope', async () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scanner-events-'));
  const child = path.join(rootPath, 'parts');
  fs.mkdirSync(child);
  fs.writeFileSync(path.join(child, 'one.stl'), 'solid one');
  try {
    const events: DiscoveryEvent[] = [];
    for await (const event of streamDiscoverFolder(rootPath, undefined, 42)) events.push(event);
    assert.deepEqual(events.map((event) => event.type), [
      'file', 'scope-complete', 'scope-complete', 'discovery-complete',
    ]);
    assert.equal(events[1].type === 'scope-complete' && events[1].scopePath === child && events[1].kind === 'directory', true);
    assert.equal(events[2].type === 'scope-complete' && events[2].scopePath === rootPath && events[2].kind === 'directory', true);

    const controller = new AbortController();
    const iterator = streamDiscoverFolder(rootPath, controller.signal, 43)[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.value?.type, 'file');
    controller.abort();
    const terminal = await iterator.next();
    assert.deepEqual(terminal.value, { type: 'discovery-complete', rootPath, cancelled: true });
    assert.equal((await iterator.next()).done, true);
  } finally { fs.rmSync(rootPath, { recursive: true, force: true }); }
});

test('scope kind distinguishes a directory ending in zip from an actual archive', async () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-scope-kind-'));
  const directoryPath = path.join(rootPath, 'folder.zip');
  const archivePath = path.join(rootPath, 'parts.zip');
  fs.mkdirSync(directoryPath);
  fs.writeFileSync(path.join(directoryPath, 'part.stl'), 'solid part\nendsolid part\n');
  const archive = new JSZip();
  archive.file('inside/model.obj', 'v 0 0 0\n');
  fs.writeFileSync(archivePath, await archive.generateAsync({ type: 'nodebuffer' }));
  try {
    const completed: Array<{ scopePath: string; kind: 'directory' | 'archive' }> = [];
    for await (const event of streamDiscoverFolder(rootPath)) {
      if (event.type === 'scope-complete') completed.push({ scopePath: event.scopePath, kind: event.kind });
    }
    assert.equal(completed.find((scope) => scope.scopePath === directoryPath)?.kind, 'directory');
    assert.equal(completed.find((scope) => scope.scopePath === archivePath)?.kind, 'archive');
  } finally { fs.rmSync(rootPath, { recursive: true, force: true }); }
});

test('a watcher add then remove fences an observed-absent queued scan record', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-dirty-'));
  const filePath = path.join(rootPath, 'model.stl');
  const observed = createBarrier<void>();
  const release = createBarrier<void>();
  const repository = createFileIndexRepository(fixture.db);
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, signal, generation): AsyncGenerator<DiscoveryEvent> {
      yield discovered(rootPath, filePath);
      observed.release();
      await release.wait(signal);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => ({ vertexCount: 0, faceCount: 0, dimensions: null }),
  });

  try {
    const scan = service.scan(rootPath, { batchSize: 2 });
    await observed.wait();
    const add = repository.applyWatchUpdate({
      kind: 'add', path: filePath, name: 'watcher', extension: 'stl', directory: rootPath,
      sizeBytes: 11, modifiedAt: 21, archivePath: null,
    });
    const identity = repository.getFileIdentityByPath(filePath)!;
    assert.equal(add.rowsChanged, true);
    repository.applyWatchUpdate({ kind: 'remove', path: filePath, expectedContentRevision: identity.contentRevision });

    release.release();
    const result = await scan;
    assert.equal(result.indexed, 0);
    assert.equal(repository.getFileIdentityByPath(filePath), null);
  } finally {
    service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('prunes only a starting row after a complete empty root stream', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-empty-'));
  const oldPath = path.join(rootPath, 'removed.stl');
  const repository = createFileIndexRepository(fixture.db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: oldPath, name: 'removed', extension: 'stl', directory: rootPath,
    sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
  }] });
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation): AsyncGenerator<DiscoveryEvent> {
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
  });
  try {
    const result = await service.scan(rootPath);
    assert.equal(result.state, 'completed');
    assert.equal(result.deletedCount, 1);
    assert.equal(repository.getFileIdentityByPath(oldPath), null);
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('an unavailable root retains its starting rows', async () => {
  const fixture = createTestDb();
  const rootPath = path.join(os.tmpdir(), `polytray-scan-unavailable-${process.pid}-${Date.now()}`);
  const oldPath = path.join(rootPath, 'kept.stl');
  const repository = createFileIndexRepository(fixture.db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: oldPath, name: 'kept', extension: 'stl', directory: rootPath,
    sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
  }] });
  const service = createScanService({ db: fixture.db });
  try {
    const result = await service.scan(rootPath);
    assert.equal(result.state, 'failed');
    assert.equal(result.deletedCount, 0);
    assert.equal(repository.getFileIdentityByPath(oldPath) !== null, true);
  } finally {
    await service.dispose();
    fixture.cleanup();
  }
});

test('a corrupt archive retains its members while a complete parent prunes missing siblings', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-archive-error-'));
  const archivePath = path.join(rootPath, 'broken.zip');
  const oldMember = `${archivePath}::entry::inside.stl`;
  const oldSibling = path.join(rootPath, 'deleted.stl');
  fs.writeFileSync(archivePath, 'not a zip');
  const repository = createFileIndexRepository(fixture.db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [
    { path: oldMember, name: 'inside', extension: 'stl', directory: rootPath, sizeBytes: 10, modifiedAt: 20, scanGeneration: 1 },
    { path: oldSibling, name: 'deleted', extension: 'stl', directory: rootPath, sizeBytes: 10, modifiedAt: 20, scanGeneration: 1 },
  ] });
  const service = createScanService({ db: fixture.db });
  try {
    const result = await service.scan(rootPath);
    assert.equal(result.state, 'partial');
    assert.equal(result.deletedCount, 1);
    assert.equal(repository.getFileIdentityByPath(oldMember) !== null, true);
    assert.equal(repository.getFileIdentityByPath(oldSibling), null);
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('cancellation retains starting rows and drops an uncommitted discovered record', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-cancel-'));
  const oldPath = path.join(rootPath, 'old.stl');
  const newPath = path.join(rootPath, 'new.stl');
  const repository = createFileIndexRepository(fixture.db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: oldPath, name: 'old', extension: 'stl', directory: rootPath,
    sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
  }] });
  const entered = createBarrier<void>();
  const jobs: string[] = [];
  const states: string[] = [];
  const service = createScanService({
    db: fixture.db,
    onJobChanged: (job) => { states.push(job.state); if (job.state === 'running') jobs.push(job.jobId); },
    discover: async function* (_root, signal, generation): AsyncGenerator<DiscoveryEvent> {
      yield discovered(rootPath, newPath);
      await entered.wait(signal);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 2 });
    await entered.reached;
    const jobId = jobs[0];
    assert.equal(service.cancel(jobId), true);
    const result = await scan;
    assert.equal(result.state, 'cancelled');
    assert.equal(repository.getFileIdentityByPath(oldPath) !== null, true);
    assert.equal(repository.getFileIdentityByPath(newPath), null);
    assert.equal(result.deletedCount, 0);
    assert.equal(states.includes('cancelling'), true);
    assert.equal(states.includes('cancelled'), true);
  } finally {
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('metadata that finishes after a watcher revision cannot overwrite the watcher result', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-enrichment-'));
  const filePath = path.join(rootPath, 'model.stl');
  const indexed = createBarrier<void>();
  const metadataEntered = createBarrier<void>();
  const metadataRelease = createBarrier<void>();
  const repository = createFileIndexRepository(fixture.db);
  const unsubscribe = subscribeToFileIndexMutations(fixture.db, (mutation) => {
    if (mutation.affectedPaths.includes(filePath)) indexed.release();
  });
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation): AsyncGenerator<DiscoveryEvent> {
      yield discovered(rootPath, filePath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => {
      metadataEntered.release();
      await metadataRelease.wait();
      return { vertexCount: 99, faceCount: 33, dimensions: { x: 9, y: 9, z: 9 } };
    },
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 1 });
    await indexed.wait();
    await metadataEntered.wait();
    const before = repository.getFileIdentityByPath(filePath)!;
    repository.applyWatchUpdate({ kind: 'change', path: filePath, name: 'model', extension: 'stl',
      directory: rootPath, sizeBytes: 11, modifiedAt: 21, archivePath: null,
      expectedContentRevision: before.contentRevision });
    const after = repository.getFileIdentityByPath(filePath)!;
    repository.updateFileMetadata({ fileId: after.id, expectedContentRevision: after.contentRevision, tags: ['watcher'], notes: 'new revision' });
    metadataRelease.release();

    const result = await scan;
    const row = fixture.db.prepare('SELECT vertex_count, face_count, tags, notes FROM files WHERE path = ?').get(filePath) as {
      vertex_count: number; face_count: number; tags: string; notes: string;
    };
    assert.equal(result.metadataCompleted, 0);
    assert.equal(row.vertex_count, 0);
    assert.equal(row.face_count, 0);
    assert.equal(row.tags, '["watcher"]');
    assert.equal(row.notes, 'new revision');
  } finally {
    unsubscribe();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('malformed worker summaries fail enrichment without writing invalid metadata', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-invalid-metadata-'));
  const filePath = path.join(rootPath, 'model.obj');
  const requestReceived = createBarrier<MetadataWorkerRequest>();
  class FakeWorker extends EventEmitter {
    requests: MetadataWorkerRequest[] = [];
    postMessage(request: MetadataWorkerRequest) { this.requests.push(request); requestReceived.release(request); }
    kill() { return true; }
  }
  const worker = new FakeWorker();
  const metadataClient = new MetadataWorkerClient({ spawn: () => { setImmediate(() => worker.emit('spawn')); return worker as never; } });
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation): AsyncGenerator<DiscoveryEvent> {
      yield discovered(rootPath, filePath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: (path, extension, context) => metadataClient.extract({
      requestId: context.requestId, fileId: context.identity.id,
      contentRevision: context.identity.contentRevision, filePath: path, extension,
    }, { signal: context.signal }),
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 1 });
    const request = await requestReceived.wait();
    worker.emit('message', { requestId: request.requestId, summary: { vertexCount: -1, faceCount: 2, dimensions: { x: 1, y: 2, z: 3 } } });
    const result = await scan;
    assert.equal(result.metadataCompleted, 0);
    assert.equal(result.metadataFailed, 1);
    const row = fixture.db.prepare('SELECT vertex_count, face_count FROM files WHERE path = ?').get(filePath) as { vertex_count: number; face_count: number };
    assert.deepEqual(row, { vertex_count: 0, face_count: 0 });
  } finally {
    await service.dispose();
    await metadataClient.shutdown();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('coalesces identical roots and serializes overlapping roots without blocking unrelated roots', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-lock-'));
  const parent = path.join(rootPath, 'parent');
  const child = path.join(parent, 'child');
  const unrelated = path.join(rootPath, 'unrelated');
  const parentEntered = createBarrier<void>();
  const parentRelease = createBarrier<void>();
  const childEntered = createBarrier<void>();
  const unrelatedEntered = createBarrier<void>();
  let discoverCalls = 0;
  const service = createScanService({
    db: fixture.db,
    discover: async function* (root, signal, generation): AsyncGenerator<DiscoveryEvent> {
      discoverCalls++;
      if (root === parent) { parentEntered.release(); await parentRelease.wait(signal); }
      if (root === child) childEntered.release();
      if (root === unrelated) unrelatedEntered.release();
      yield { type: 'scope-complete', rootPath: root, scopePath: root, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath: root, cancelled: false };
    },
  });
  try {
    const parentScan = service.scan(parent);
    const duplicate = service.scan(parent);
    assert.equal(parentScan, duplicate);
    await parentEntered.wait();
    const childScan = service.scan(child);
    const independentScan = service.scan(unrelated);
    await unrelatedEntered.wait();
    assert.equal(discoverCalls, 2);
    parentRelease.release();
    await childEntered.wait();
    await Promise.all([parentScan, childScan, independentScan]);
    assert.equal(discoverCalls, 3);
  } finally {
    parentRelease.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('keeps discovery events and queued metadata within two configured batches', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-bounds-'));
  const metadataEntered = createBarrier<void>();
  const metadataRelease = createBarrier<void>();
  const fullMetadataQueue = createBarrier<void>();
  const observedDepths: Array<{ discovery: number; metadata: number }> = [];
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation): AsyncGenerator<DiscoveryEvent> {
      for (let index = 0; index < 12; index++) yield discovered(rootPath, path.join(rootPath, `model-${index}.stl`));
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async () => {
      metadataEntered.release();
      await metadataRelease.wait();
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
    onThrottle: (discovery, metadata) => {
      observedDepths.push({ discovery, metadata });
      if (metadata === 4) fullMetadataQueue.release();
    },
  });
  try {
    const scan = service.scan(rootPath, { batchSize: 2 });
    await metadataEntered.wait();
    await fullMetadataQueue.wait();
    assert.equal(observedDepths.every(({ discovery, metadata }) => discovery <= 2 && metadata <= 4), true);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM files').get() &&
      (fixture.db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count >= 4, true);
    metadataRelease.release();
    const result = await scan;
    assert.equal(result.indexed, 12);
    assert.equal(result.metadataCompleted, 12);
  } finally {
    metadataRelease.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('cancels a queued overlapping scan without waiting for the active root', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-queued-cancel-'));
  const parent = path.join(rootPath, 'parent');
  const child = path.join(parent, 'child');
  const parentEntered = createBarrier<void>();
  const parentRelease = createBarrier<void>();
  let discoverCalls = 0;
  const terminalEvents = new Map<string, number>();
  const service = createScanService({
    db: fixture.db,
    onJobChanged: (job) => {
      if (job.state === 'cancelled') terminalEvents.set(job.jobId, (terminalEvents.get(job.jobId) ?? 0) + 1);
    },
    discover: async function* (root, signal, generation): AsyncGenerator<DiscoveryEvent> {
      discoverCalls++;
      if (root === parent) { parentEntered.release(); await parentRelease.wait(signal); }
      yield { type: 'scope-complete', rootPath: root, scopePath: root, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath: root, cancelled: false };
    },
  });
  try {
    const parentScan = service.scan(parent);
    await parentEntered.wait();
    const childScan = service.scan(child);
    const childJob = service.getBackgroundJobs().find((job) => job.rootPath === child)!;
    assert.equal(childJob.state, 'queued');
    assert.equal(service.cancel(childJob.jobId), true);
    const cancelled = await childScan;
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === childJob.jobId)?.state, 'cancelled');
    assert.equal(terminalEvents.get(childJob.jobId), 1);
    assert.equal(discoverCalls, 1);

    parentRelease.release();
    await parentScan;
  } finally {
    parentRelease.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('cancelling metadata retry prevents the next failed file from starting', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-retry-cancel-'));
  const firstPath = path.join(rootPath, 'first.stl');
  const secondPath = path.join(rootPath, 'second.stl');
  const retryEntered = createBarrier<void>();
  const retryRelease = createBarrier<void>();
  const attempts = new Map<string, number>();
  const service = createScanService({
    db: fixture.db,
    discover: async function* (_root, _signal, generation) {
      yield discovered(rootPath, firstPath);
      yield discovered(rootPath, secondPath);
      yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath, cancelled: false };
    },
    extractMetadata: async (filePath, _extension, { signal }) => {
      const attempt = (attempts.get(filePath) ?? 0) + 1;
      attempts.set(filePath, attempt);
      if (attempt === 1) throw new Error('initial failure');
      if (filePath === firstPath) {
        retryEntered.release();
        await retryRelease.wait(signal);
      }
      return { vertexCount: 1, faceCount: 1, dimensions: null };
    },
  });
  try {
    const initial = await service.scan(rootPath, { batchSize: 2 });
    assert.equal(initial.state, 'partial');
    const retry = service.retryFailures(initial.jobId);
    await retryEntered.wait();
    assert.equal(service.cancel(initial.jobId), true);
    assert.equal(await retry, true);
    assert.deepEqual([...attempts.entries()].sort(), [[firstPath, 2], [secondPath, 1]]);
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === initial.jobId)?.state, 'cancelled');
  } finally {
    retryRelease.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('cancelling scope retry aborts its nested discovery and prevents pruning', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-scope-retry-cancel-'));
  const failedScope = path.join(rootPath, 'offline');
  const stalePath = path.join(failedScope, 'stale.stl');
  const secondFailedScope = path.join(rootPath, 'offline-too');
  const secondStalePath = path.join(secondFailedScope, 'stale-too.stl');
  const nestedDiscovery = createBarrier<void>();
  const nestedRelease = createBarrier<void>();
  const repository = createFileIndexRepository(fixture.db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: stalePath, name: 'stale', extension: 'stl', directory: failedScope,
    sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
  }, {
    path: secondStalePath, name: 'stale-too', extension: 'stl', directory: secondFailedScope,
    sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
  }] });
  let nestedSignal: AbortSignal | undefined;
  let discoverCalls = 0;
  const service = createScanService({
    db: fixture.db,
    discover: async function* (root, signal, generation) {
      discoverCalls++;
      if (root === rootPath) {
        yield { type: 'scope-error', rootPath, scopePath: failedScope, phase: 'discovery', code: 'READDIR_FAILED', reason: 'offline', kind: 'directory' };
        yield { type: 'scope-error', rootPath, scopePath: secondFailedScope, phase: 'discovery', code: 'READDIR_FAILED', reason: 'offline', kind: 'directory' };
        yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
        yield { type: 'discovery-complete', rootPath, cancelled: false };
        return;
      }
      nestedSignal = signal;
      nestedDiscovery.release();
      await nestedRelease.wait(signal);
      yield { type: 'scope-complete', rootPath: root, scopePath: root, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath: root, cancelled: false };
    },
  });
  try {
    const initial = await service.scan(rootPath);
    assert.equal(initial.state, 'partial');
    const retry = service.retryFailures(initial.jobId);
    await nestedDiscovery.wait();
    assert.equal(service.cancel(initial.jobId), true);
    assert.equal(nestedSignal?.aborted, true);
    const retryAccepted = await retry;
    assert.equal(retryAccepted, true);
    assert.equal(discoverCalls, 2);
    assert.equal(repository.getFileIdentityByPath(stalePath) !== null, true);
    assert.equal(repository.getFileIdentityByPath(secondStalePath) !== null, true);
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === initial.jobId)?.state, 'cancelled');
  } finally {
    nestedRelease.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('cancelling a retry coalesced with an independent scope scan settles without cancelling the shared scan', async () => {
  const fixture = createTestDb();
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-retry-coalesce-cancel-'));
  const failedScope = path.join(rootPath, 'offline');
  const sharedStarted = createBarrier<void>();
  const retryStarted = createBarrier<void>();
  const retryCancelled = createBarrier<void>();
  const sharedRelease = createBarrier<void>();
  let activeSharedSignal: AbortSignal | undefined;
  let awaitingRetryStart = false;
  const service = createScanService({
    db: fixture.db,
    onJobChanged: (job) => {
      if (awaitingRetryStart && job.rootPath === rootPath && job.state === 'running') retryStarted.release();
      if (awaitingRetryStart && job.rootPath === rootPath && job.state === 'cancelled') retryCancelled.release();
    },
    discover: async function* (root, signal, generation) {
      if (root === rootPath) {
        yield { type: 'scope-error', rootPath, scopePath: failedScope, phase: 'discovery', code: 'READDIR_FAILED', reason: 'offline', kind: 'directory' };
        yield { type: 'scope-complete', rootPath, scopePath: rootPath, generation, kind: 'directory' };
        yield { type: 'discovery-complete', rootPath, cancelled: false };
        return;
      }
      activeSharedSignal = signal;
      sharedStarted.release();
      await sharedRelease.wait(signal);
      yield { type: 'scope-complete', rootPath: root, scopePath: root, generation, kind: 'directory' };
      yield { type: 'discovery-complete', rootPath: root, cancelled: false };
    },
  });
  try {
    const initial = await service.scan(rootPath);
    assert.equal(initial.state, 'partial');
    const sharedScan = service.scan(failedScope);
    await sharedStarted.wait();
    awaitingRetryStart = true;
    const retry = service.retryFailures(initial.jobId);
    await retryStarted.wait();
    let retrySettled = false;
    void retry.then(() => { retrySettled = true; });
    assert.equal(service.cancel(initial.jobId), true);

    await retryCancelled.wait();
    await retry;
    assert.equal(retrySettled, true);
    assert.equal(service.getBackgroundJobs().find((job) => job.jobId === initial.jobId)?.state, 'cancelled');
    assert.equal(activeSharedSignal?.aborted, false);
    assert.equal(service.getBackgroundJobs().some((job) => job.rootPath === failedScope && job.state === 'running'), true);

    sharedRelease.release();
    await sharedScan;
  } finally {
    sharedRelease.release();
    await service.dispose();
    fixture.cleanup();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
