import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createDbAtVersion } from '../../../support/helpers/databaseFixtures';
import { createBarrier } from '../../../support/helpers/performanceProbe';
import { createFileIndexRepository, subscribeToFileIndexMutations } from '../../../../src/main/fileIndexing';
import { createScanService } from '../../../../src/main/scanService';
import type { DiscoveryEvent } from '../../../../src/shared/backgroundJobs';
import type { ScanProgressData } from '../../../../src/shared/types';
import { streamDiscoverFolder } from '../../../../src/main/scanner';

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
  const service = createScanService({
    db: fixture.db,
    onJobChanged: (job) => { if (job.state === 'running') jobs.push(job.jobId); },
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
  const service = createScanService({
    db: fixture.db,
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
