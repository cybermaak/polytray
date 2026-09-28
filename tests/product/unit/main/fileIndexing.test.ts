import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFileIndexRepository,
  applyScannedFileRecord,
  applyWatchedFileRecord,
  type CommittedFileMutation,
  subscribeToFileIndexMutations,
  mergeScannedFileRecord,
  mergeWatchedFileRecord,
  type IndexedFileRecord,
} from '../../../../src/main/fileIndexing';
import { enumerateFileScopes } from '../../../../src/main/fileScopes';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../../../src/main/database';

function makeExistingRecord(overrides: Partial<IndexedFileRecord> = {}): IndexedFileRecord {
  return {
    path: '/models/a.stl',
    name: 'a',
    ext: 'stl',
    dir: '/models',
    size: 100,
    modifiedAt: 200,
    vertexCount: 20,
    faceCount: 10,
    dimensions: { x: 1, y: 1, z: 1 },
    thumbnailPath: '/thumb.png',
    thumbnailFailed: 0,
    indexedAt: 5000,
    ...overrides,
  };
}

test('scan merge does not downgrade a newer existing file record', () => {
  const merged = mergeScannedFileRecord(makeExistingRecord(), {
    path: '/models/a.stl',
    name: 'a-old',
    ext: 'stl',
    dir: '/models',
    size: 90,
    mtime: 150,
    vertexCount: 10,
    faceCount: 5,
    indexedAt: 1000,
  });

  assert.equal(merged.name, 'a');
  assert.equal(merged.size, 100);
  assert.equal(merged.modifiedAt, 200);
  assert.equal(merged.thumbnailPath, '/thumb.png');
  assert.equal(merged.indexedAt, 5000);
  assert.deepEqual(merged.dimensions, { x: 1, y: 1, z: 1 });
});

test('scan merge clears thumbnail state when the scanned file is newer', () => {
  const merged = mergeScannedFileRecord(
    makeExistingRecord({ thumbnailPath: '/thumb.png', thumbnailFailed: 1 }),
    {
      path: '/models/a.stl',
      name: 'a-new',
      ext: 'stl',
      dir: '/models',
      size: 120,
      mtime: 250,
      vertexCount: 30,
      faceCount: 12,
      dimensions: { x: 2, y: 2, z: 2 },
      indexedAt: 6000,
    },
  );

  assert.equal(merged.name, 'a-new');
  assert.equal(merged.thumbnailPath, null);
  assert.equal(merged.thumbnailFailed, 0);
  assert.equal(merged.indexedAt, 6000);
  assert.deepEqual(merged.dimensions, { x: 2, y: 2, z: 2 });
});

test('watcher merge does not overwrite a newer scanned record', () => {
  const merged = mergeWatchedFileRecord(
    makeExistingRecord({
      name: 'scan-new',
      modifiedAt: 300,
      vertexCount: 40,
      faceCount: 20,
      dimensions: { x: 3, y: 3, z: 3 },
      thumbnailPath: null,
      indexedAt: 7000,
    }),
    {
      path: '/models/a.stl',
      name: 'watch-old',
      ext: 'stl',
      dir: '/models',
      size: 90,
      modifiedAt: 250,
      vertexCount: 10,
      faceCount: 5,
      dimensions: { x: 0.5, y: 0.5, z: 0.5 },
      thumbnailPath: '/watch-thumb.png',
      thumbnailFailed: 0,
      indexedAt: 6500,
    },
  );

  assert.equal(merged.name, 'scan-new');
  assert.equal(merged.modifiedAt, 300);
  assert.equal(merged.thumbnailPath, null);
  assert.equal(merged.indexedAt, 7000);
  assert.deepEqual(merged.dimensions, { x: 3, y: 3, z: 3 });
});

test('watcher merge applies thumbnail and metadata for a current file event', () => {
  const merged = mergeWatchedFileRecord(null, {
    path: '/models/a.stl',
    name: 'watch-new',
    ext: 'stl',
    dir: '/models',
    size: 110,
    modifiedAt: 320,
    vertexCount: 44,
    faceCount: 21,
    dimensions: { x: 4, y: 4, z: 4 },
    thumbnailPath: '/watch-thumb.png',
    thumbnailFailed: 0,
    indexedAt: 7200,
  });

  assert.equal(merged.name, 'watch-new');
  assert.equal(merged.thumbnailPath, '/watch-thumb.png');
  assert.equal(merged.modifiedAt, 320);
  assert.equal(merged.indexedAt, 7200);
  assert.deepEqual(merged.dimensions, { x: 4, y: 4, z: 4 });
});

test('a changed file at the same timestamp clears its old thumbnail identity', () => {
  const existing = makeExistingRecord({
    size: 100,
    modifiedAt: 200,
    vertexCount: 90,
    thumbnailPath: null,
  });
  const merged = mergeScannedFileRecord(existing, {
    path: existing.path,
    name: existing.name,
    ext: existing.ext,
    dir: existing.dir,
    size: 120,
    mtime: 200,
    vertexCount: 20,
    faceCount: 10,
    dimensions: { x: 1, y: 1, z: 1 },
    indexedAt: 6000,
  });

  assert.equal(merged.size, 120);
  assert.equal(merged.vertexCount, 20);
  assert.equal(merged.thumbnailPath, null);
});

function createRepositoryDatabase() {
  const db = new Database(':memory:');
  db.exec(MIGRATIONS.map((migration) => migration.sql).join('\n'));
  return db;
}

test('index batches preserve annotations and maintain scopes with the file row', () => {
  const db = createRepositoryDatabase();
  try {
    const repository = createFileIndexRepository(db);
    const record = {
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models',
      sizeBytes: 100, modifiedAt: 200, scanGeneration: 7,
    };
    repository.applyIndexBatch({ scanGeneration: 7, records: [record] });
    db.prepare("UPDATE files SET tags = 'favorite', notes = 'keep', print_status = 'Testing', thumbnail = '/cache.png'").run();

    repository.applyIndexBatch({ scanGeneration: 8, records: [{ ...record, name: 'renamed', scanGeneration: 8 }] });
    const row = db.prepare('SELECT tags, notes, print_status, name FROM files WHERE path = ?').get(record.path) as Record<string, string>;
    assert.deepEqual(row, { tags: 'favorite', notes: 'keep', print_status: 'Testing', name: 'renamed' });
    assert.equal((db.prepare('SELECT thumbnail FROM files WHERE path = ?').get(record.path) as { thumbnail: string }).thumbnail, '/cache.png');
    const actualScopes = (db.prepare('SELECT scope_path FROM file_scopes').all() as Array<{ scope_path: string }>)
      .map((row) => row.scope_path).sort();
    assert.deepEqual(actualScopes, enumerateFileScopes(record.path).sort());

    repository.applyIndexBatch({ scanGeneration: 9, records: [{ ...record, sizeBytes: 120, name: 'renamed', scanGeneration: 9 }] });
    const changed = db.prepare('SELECT tags, notes, print_status, thumbnail, content_revision FROM files WHERE path = ?').get(record.path) as Record<string, unknown>;
    assert.deepEqual(changed, { tags: 'favorite', notes: 'keep', print_status: 'Testing', thumbnail: null, content_revision: 3 });
  } finally {
    db.close();
  }
});

test('metadata enrichment from an older content revision is rejected', () => {
  const db = createRepositoryDatabase();
  try {
    const repository = createFileIndexRepository(db);
    repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models', sizeBytes: 100, modifiedAt: 200, scanGeneration: 1,
    }] });
    const identity = db.prepare('SELECT id, content_revision FROM files WHERE path = ?').get('/models/a.stl') as { id: number; content_revision: number };
    repository.applyWatchUpdate({
      kind: 'change', path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models',
      sizeBytes: 120, modifiedAt: 200, archivePath: null,
    });
    const staleScan = repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/models/a.stl', name: 'stale-scan-name', extension: 'stl', directory: '/models',
      sizeBytes: 100, modifiedAt: 200, scanGeneration: 1,
      expectedContentRevision: identity.content_revision,
    }] });
    assert.equal(staleScan.unchanged, 1);

    const result = repository.applyMetadataResult({
      fileId: identity.id, path: '/models/a.stl', expectedContentRevision: identity.content_revision,
      vertexCount: 10, faceCount: 5, dimensions: '{"x":1,"y":1,"z":1}',
    });
    assert.equal(result.status, 'stale');
    assert.equal((db.prepare('SELECT vertex_count FROM files WHERE id = ?').get(identity.id) as { vertex_count: number }).vertex_count, 0);
    assert.equal((db.prepare('SELECT name, size_bytes FROM files WHERE id = ?').get(identity.id) as { name: string; size_bytes: number }).name, 'a');
  } finally {
    db.close();
  }
});

test('metadata enrichment persists versioned unavailable provenance without touching annotations or thumbnail', () => {
  const db = createRepositoryDatabase();
  try {
    const repository = createFileIndexRepository(db);
    repository.applyIndexBatch({ scanGeneration: 3, records: [{
      path: '/models/a.3mf', name: 'a', extension: '3mf', directory: '/models', sizeBytes: 100, modifiedAt: 200, scanGeneration: 3,
    }] });
    db.prepare("UPDATE files SET tags = 'keep', notes = 'note', thumbnail = '/cache/a.png' WHERE path = '/models/a.3mf'").run();
    const identity = db.prepare('SELECT id, content_revision FROM files WHERE path = ?').get('/models/a.3mf') as { id: number; content_revision: number };
    const measurement = JSON.stringify({ version: 1, x: null, y: null, z: null, unit: 'mm', basis: 'source-build', status: 'unavailable', reason: 'External component reference is unsupported' });
    const result = repository.applyMetadataResult({
      fileId: identity.id, path: '/models/a.3mf', expectedContentRevision: identity.content_revision,
      vertexCount: 0, faceCount: 0, dimensions: measurement,
    });
    assert.equal(result.status, 'updated');
    const row = db.prepare('SELECT dimensions, tags, notes, thumbnail FROM files WHERE id = ?').get(identity.id) as Record<string, string>;
    assert.deepEqual(row, { dimensions: measurement, tags: 'keep', notes: 'note', thumbnail: '/cache/a.png' });
  } finally { db.close(); }
});

test('same-path delete and recreate cannot be pruned by an earlier scan candidate', () => {
  const db = createRepositoryDatabase();
  try {
    const repository = createFileIndexRepository(db);
    repository.applyIndexBatch({ scanGeneration: 9, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models', sizeBytes: 100, modifiedAt: 200, scanGeneration: 9,
    }] });
    const old = db.prepare('SELECT content_revision FROM files WHERE path = ?').get('/models/a.stl') as { content_revision: number };
    repository.applyWatchUpdate({ kind: 'remove', path: '/models/a.stl', expectedContentRevision: old.content_revision });
    repository.applyWatchUpdate({
      kind: 'add', path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models',
      sizeBytes: 100, modifiedAt: 200, archivePath: null,
    });

    repository.deleteContainedFiles('/models', [{ path: '/models/a.stl', scanGeneration: 9, expectedContentRevision: old.content_revision }]);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM files WHERE path = ?').get('/models/a.stl')?.count, 1);
  } finally {
    db.close();
  }
});

test('a stale scan with an observed positive revision cannot resurrect a watcher-removed file', () => {
  const db = createRepositoryDatabase();
  try {
    const notifications: CommittedFileMutation[] = [];
    const repository = createFileIndexRepository(db, (mutation) => notifications.push(mutation));
    const record = {
      path: '/models/removed.stl', name: 'removed', extension: 'stl', directory: '/models',
      sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
    };
    const inserted = repository.applyIndexBatch({ scanGeneration: 1, records: [record] });
    const identity = inserted.committed[0];
    repository.applyWatchUpdate({ kind: 'remove', path: record.path, expectedContentRevision: identity.contentRevision });
    notifications.length = 0;
    const revisionBeforeStaleScan = repository.getBrowseRevision();

    const result = repository.applyIndexBatch({ scanGeneration: 1, records: [{
      ...record, expectedContentRevision: identity.contentRevision,
    }] });

    assert.equal(result.inserted, 0);
    assert.equal(result.unchanged, 1);
    assert.deepEqual(result.committed, []);
    assert.equal(db.prepare('SELECT id FROM files WHERE path = ?').get(record.path), undefined);
    assert.equal(repository.getBrowseRevision(), revisionBeforeStaleScan);
    assert.deepEqual(notifications, []);
  } finally {
    db.close();
  }
});

test('an observed-absent scan add cannot overwrite a later watcher add', () => {
  const db = createRepositoryDatabase();
  try {
    const notifications: CommittedFileMutation[] = [];
    const repository = createFileIndexRepository(db, (mutation) => notifications.push(mutation));
    const observedAbsent = {
      path: '/models/added.stl', name: 'scan', extension: 'stl', directory: '/models',
      sizeBytes: 10, modifiedAt: 20, scanGeneration: 1, expectedContentRevision: 0,
    };
    const watcherAdd = repository.applyWatchUpdate({
      kind: 'add', path: observedAbsent.path, name: 'watcher', extension: 'stl', directory: '/models',
      sizeBytes: observedAbsent.sizeBytes, modifiedAt: observedAbsent.modifiedAt, archivePath: null,
    });
    assert.equal(watcherAdd.rowsChanged, true);
    notifications.length = 0;
    const identityBeforeStaleAdd = repository.getFileIdentityByPath(observedAbsent.path)!;

    const result = repository.applyIndexBatch({ scanGeneration: 1, records: [observedAbsent] });

    assert.equal(result.inserted, 0);
    assert.equal(result.unchanged, 1);
    assert.deepEqual(result.committed, []);
    assert.equal(repository.getFileIdentityByPath(observedAbsent.path)?.contentRevision, identityBeforeStaleAdd.contentRevision);
    assert.equal((db.prepare('SELECT name FROM files WHERE path = ?').get(observedAbsent.path) as { name: string }).name, 'watcher');
    assert.deepEqual(notifications, []);

    const genuinelyAbsent = repository.applyIndexBatch({ scanGeneration: 1, records: [{
      ...observedAbsent, path: '/models/genuinely-absent.stl', expectedContentRevision: 0,
    }] });
    assert.equal(genuinelyAbsent.inserted, 1);
    assert.equal(genuinelyAbsent.committed.length, 1);
  } finally {
    db.close();
  }
});

test('repository publishes one typed mutation only after the indexed row commits', () => {
  const db = createRepositoryDatabase();
  try {
    let eventCount = 0;
    const repository = createFileIndexRepository(db, (mutation) => {
      eventCount++;
      assert.equal(mutation.rowsChanged, true);
      assert.equal(mutation.affectedPaths[0], '/models/a.stl');
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 1);
    });
    repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models', sizeBytes: 100, modifiedAt: 200, scanGeneration: 1,
    }] });
    assert.equal(eventCount, 1);
  } finally {
    db.close();
  }
});

test('repository sends no post-commit notification when its transaction rolls back', () => {
  const db = createRepositoryDatabase();
  try {
    let notifications = 0;
    const repository = createFileIndexRepository(db, () => { notifications++; });
    db.exec(`CREATE TRIGGER reject_scope_insert BEFORE INSERT ON file_scopes
      BEGIN SELECT RAISE(ABORT, 'forced scope failure'); END`);

    assert.throws(() => repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models',
      sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
    }] }), /forced scope failure/);
    assert.equal(notifications, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 0);
    assert.equal(repository.getBrowseRevision(), 0);
  } finally {
    db.close();
  }
});

test('late index chunk failure notifies committed rows only and leaves the failed chunk rolled back', () => {
  const db = createRepositoryDatabase();
  try {
    const notifications: CommittedFileMutation[] = [];
    const repository = createFileIndexRepository(db, (mutation) => notifications.push(mutation));
    db.exec(`CREATE TRIGGER reject_late_scope BEFORE INSERT ON file_scopes
      WHEN (SELECT path FROM files WHERE id = NEW.file_id) = '/models/250.stl'
      BEGIN SELECT RAISE(ABORT, 'forced late scope failure'); END`);
    const records = Array.from({ length: 251 }, (_, index) => ({
      path: `/models/${String(index).padStart(3, '0')}.stl`, name: String(index), extension: 'stl', directory: '/models',
      sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
    }));

    assert.throws(() => repository.applyIndexBatch({ scanGeneration: 1, records }), /forced late scope failure/);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 250);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].affectedPaths.length, 250);
    assert.equal(notifications[0].affectedPaths.includes('/models/250.stl'), false);
    assert.equal(repository.getBrowseRevision(), 1);
  } finally {
    db.close();
  }
});

test('late contained deletion failure notifies the prior committed chunk only', () => {
  const db = createRepositoryDatabase();
  try {
    const notifications: CommittedFileMutation[] = [];
    const repository = createFileIndexRepository(db, (mutation) => notifications.push(mutation));
    const records = Array.from({ length: 251 }, (_, index) => ({
      path: `/models/${String(index).padStart(3, '0')}.stl`, name: String(index), extension: 'stl', directory: '/models',
      sizeBytes: 10, modifiedAt: 20, scanGeneration: 7,
    }));
    const indexed = repository.applyIndexBatch({ scanGeneration: 7, records });
    notifications.length = 0;
    const candidates = indexed.committed.map((row) => ({
      path: row.path, scanGeneration: 7, expectedContentRevision: row.contentRevision,
    }));
    db.exec(`CREATE TRIGGER reject_late_delete BEFORE DELETE ON files
      WHEN OLD.path = '/models/250.stl'
      BEGIN SELECT RAISE(ABORT, 'forced late delete failure'); END`);

    assert.throws(() => repository.deleteContainedFiles('/models', candidates), /forced late delete failure/);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 1);
    assert.ok(db.prepare("SELECT id FROM files WHERE path = '/models/250.stl'").get());
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].affectedPaths.length, 250);
    assert.equal(notifications[0].affectedPaths.includes('/models/250.stl'), false);
  } finally {
    db.close();
  }
});

test('throwing and rejecting mutation observers do not break writes or starve other observers', async () => {
  const db = createRepositoryDatabase();
  const originalError = console.error;
  const observerErrors: unknown[] = [];
  try {
    console.error = (...values: unknown[]) => { observerErrors.push(values.at(-1)); };
    let received = 0;
    const repository = createFileIndexRepository(db, () => { throw new Error('sync observer failure'); });
    createFileIndexRepository(db, async () => { throw new Error('async observer failure'); });
    subscribeToFileIndexMutations(db, () => { received++; });

    assert.doesNotThrow(() => repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models',
      sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
    }] }));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(received, 1);
    assert.equal(observerErrors.length, 2);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 1);
  } finally {
    console.error = originalError;
    db.close();
  }
});

test('thumbnail updates are revision guarded and do not advance browse revision', () => {
  const db = createRepositoryDatabase();
  try {
    const repository = createFileIndexRepository(db);
    repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models', sizeBytes: 100, modifiedAt: 200, scanGeneration: 1,
    }] });
    const row = db.prepare('SELECT id, content_revision FROM files WHERE path = ?').get('/models/a.stl') as { id: number; content_revision: number };
    const revision = repository.getBrowseRevision();
    let event: CommittedFileMutation | undefined;
    const withEvents = createFileIndexRepository(db, (mutation) => { event = mutation; });

    const result = withEvents.updateThumbnailState({
      fileId: row.id, expectedContentRevision: row.content_revision,
      thumbnailPath: '/cache/a.png', thumbnailFailed: 0,
    });
    assert.equal(result.status, 'updated');
    assert.equal(withEvents.getBrowseRevision(), revision);
    assert.equal(event?.thumbnailOnly, true);

    const changed = withEvents.applyWatchUpdate({
      kind: 'change', path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models',
      sizeBytes: 101, modifiedAt: 200, archivePath: null,
    });
    const stale = withEvents.updateThumbnailState({
      fileId: row.id, expectedContentRevision: row.content_revision,
      thumbnailPath: '/cache/stale.png', thumbnailFailed: 0,
    });
    assert.equal(changed.rowsChanged, true);
    assert.equal(stale.status, 'stale');
    assert.equal((db.prepare('SELECT thumbnail FROM files WHERE id = ?').get(row.id) as { thumbnail: string | null }).thumbnail, null);
  } finally {
    db.close();
  }
});

test('annotation edits use the revisioned repository and preserve print status', () => {
  const db = createRepositoryDatabase();
  try {
    const notifications: CommittedFileMutation[] = [];
    const repository = createFileIndexRepository(db, (mutation) => notifications.push(mutation));
    repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models', sizeBytes: 10, modifiedAt: 20, scanGeneration: 1,
    }] });
    const identity = repository.getFileIdentityByPath('/models/a.stl')!;
    db.prepare("UPDATE files SET tags = '[\"old\"]', notes = 'before', print_status = 'Testing'").run();
    const before = repository.getBrowseRevision();

    const result = repository.updateFileMetadata({
      fileId: identity.id, expectedContentRevision: identity.contentRevision, tags: [], notes: null,
    });
    assert.equal(result.status, 'updated');
    assert.equal(result.file.tags, null);
    assert.equal(result.file.notes, null);
    assert.equal((db.prepare('SELECT print_status FROM files WHERE id = ?').get(identity.id) as { print_status: string }).print_status, 'Testing');
    assert.equal(repository.getBrowseRevision(), before + 1);
    assert.equal(notifications.at(-1)?.rowsChanged, false);
    assert.equal(notifications.at(-1)?.annotationsChanged, true);
    assert.equal(notifications.at(-1)?.statsChanged, false);
    assert.equal(notifications.at(-1)?.topologyChanged, false);
  } finally {
    db.close();
  }
});

test('watcher unlink removes its current indexed identity and advances durable revisions', () => {
  const db = createRepositoryDatabase();
  try {
    const repository = createFileIndexRepository(db);
    repository.applyIndexBatch({ scanGeneration: 5, records: [{
      path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models', sizeBytes: 10, modifiedAt: 20, scanGeneration: 5,
    }] });
    const identity = repository.getFileIdentityByPath('/models/a.stl')!;
    const before = db.prepare('SELECT browse_revision, stats_revision, topology_revision FROM library_revisions WHERE singleton = 1').get() as Record<string, number>;

    const result = repository.applyWatchUpdate({
      kind: 'remove', path: identity.path, expectedContentRevision: identity.contentRevision,
    });
    const after = db.prepare('SELECT browse_revision, stats_revision, topology_revision FROM library_revisions WHERE singleton = 1').get() as Record<string, number>;
    assert.equal(result.rowsChanged, true);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM file_scopes').get() as { count: number }).count, 0);
    assert.equal(after.browse_revision, before.browse_revision + 1);
    assert.equal(after.stats_revision, before.stats_revision + 1);
    assert.equal(after.topology_revision, before.topology_revision + 1);
  } finally {
    db.close();
  }
});

test('legacy scan wrapper updates revision and scope rows while preserving unchanged cache and annotations', () => {
  const db = createRepositoryDatabase();
  try {
    const scanned = {
      path: '/models/a.stl', name: 'a', ext: 'stl', dir: '/models', size: 100, mtime: 200,
      vertexCount: 12, faceCount: 6, dimensions: { x: 1, y: 2, z: 3 }, indexedAt: 10,
    };
    applyScannedFileRecord(db, scanned);
    const first = db.prepare('SELECT id, content_revision FROM files WHERE path = ?').get(scanned.path) as { id: number; content_revision: number };
    assert.ok(first.content_revision > 1);
    const scopes = (db.prepare('SELECT scope_path FROM file_scopes WHERE file_id = ?').all(first.id) as Array<{ scope_path: string }>)
      .map((row) => row.scope_path).sort();
    assert.deepEqual(scopes, enumerateFileScopes(scanned.path).sort());

    db.prepare("UPDATE files SET tags = 'keep-tag', notes = 'keep-note', print_status = 'Testing', thumbnail = '/cached.png', scan_generation = 42").run();
    applyScannedFileRecord(db, scanned);
    const unchanged = db.prepare('SELECT content_revision, tags, notes, print_status, thumbnail, scan_generation FROM files WHERE id = ?').get(first.id) as Record<string, unknown>;
    assert.deepEqual(unchanged, {
      content_revision: first.content_revision, tags: 'keep-tag', notes: 'keep-note',
      print_status: 'Testing', thumbnail: '/cached.png', scan_generation: 42,
    });

    applyScannedFileRecord(db, { ...scanned, size: 120, vertexCount: 15 });
    const changed = db.prepare('SELECT content_revision, tags, notes, print_status, thumbnail, vertex_count FROM files WHERE id = ?').get(first.id) as Record<string, unknown>;
    assert.ok(Number(changed.content_revision) > first.content_revision);
    assert.deepEqual({ tags: changed.tags, notes: changed.notes, print_status: changed.print_status, thumbnail: changed.thumbnail, vertex_count: changed.vertex_count }, {
      tags: 'keep-tag', notes: 'keep-note', print_status: 'Testing', thumbnail: null, vertex_count: 15,
    });
    applyScannedFileRecord(db, { ...scanned, size: 1, mtime: 150, vertexCount: 1, faceCount: 1 });
    const afterStale = db.prepare('SELECT size_bytes, modified_at, content_revision, vertex_count FROM files WHERE id = ?').get(first.id) as Record<string, number>;
    assert.deepEqual(afterStale, {
      size_bytes: 120, modified_at: 200, content_revision: changed.content_revision, vertex_count: 15,
    });
    assert.ok(Number((db.prepare('SELECT browse_revision FROM library_revisions WHERE singleton = 1').get() as { browse_revision: number }).browse_revision) > 0);
  } finally {
    db.close();
  }
});

test('legacy watcher wrapper routes archive records through revisioned scopes and annotations', () => {
  const db = createRepositoryDatabase();
  try {
    const watched = {
      path: '/models/kits.zip::entry::set/a.stl', name: 'a', ext: 'stl', dir: '/models/kits.zip::entry::set',
      size: 100, modifiedAt: 200, vertexCount: 12, faceCount: 6, dimensions: { x: 1, y: 2, z: 3 },
      thumbnailPath: '/cache/a.png', thumbnailFailed: 0, indexedAt: 10,
    };
    applyWatchedFileRecord(db, watched);
    const first = db.prepare('SELECT id, content_revision, archive_path FROM files WHERE path = ?').get(watched.path) as {
      id: number; content_revision: number; archive_path: string | null;
    };
    assert.equal(first.archive_path, '/models/kits.zip');
    assert.ok(first.content_revision > 1);
    assert.ok((db.prepare('SELECT COUNT(*) AS count FROM file_scopes WHERE file_id = ?').get(first.id) as { count: number }).count >= 5);

    db.prepare("UPDATE files SET tags = 'tag', notes = 'note', print_status = 'Testing'").run();
    applyWatchedFileRecord(db, { ...watched, modifiedAt: 200, size: 100, vertexCount: 25 });
    const current = db.prepare('SELECT content_revision, tags, notes, print_status, vertex_count, thumbnail FROM files WHERE id = ?').get(first.id) as Record<string, unknown>;
    assert.ok(Number(current.content_revision) > first.content_revision);
    assert.deepEqual({ tags: current.tags, notes: current.notes, print_status: current.print_status, vertex_count: current.vertex_count, thumbnail: current.thumbnail }, {
      tags: 'tag', notes: 'note', print_status: 'Testing', vertex_count: 25, thumbnail: '/cache/a.png',
    });
  } finally {
    db.close();
  }
});

test('shared repository observer receives each legacy wrapper commit once after the write', () => {
  const db = createRepositoryDatabase();
  try {
    const received: Array<{ mutation: CommittedFileMutation; vertexCount: number; thumbnail: string | null }> = [];
    const observer = (mutation: CommittedFileMutation) => {
      const row = db.prepare('SELECT vertex_count, thumbnail FROM files WHERE path = ?').get(mutation.affectedPaths[0]) as {
        vertex_count: number; thumbnail: string | null;
      };
      assert.ok(row);
      assert.equal(row.vertex_count, 20);
      received.push({ mutation, vertexCount: row.vertex_count, thumbnail: row.thumbnail });
    };
    const first = createFileIndexRepository(db, observer);
    const second = createFileIndexRepository(db, observer);
    const unsubscribe = subscribeToFileIndexMutations(db, observer);
    const unsubscribeDuplicate = subscribeToFileIndexMutations(db, observer);
    assert.equal(first, second);

    applyScannedFileRecord(db, {
      path: '/models/a.stl', name: 'a', ext: 'stl', dir: '/models', size: 100, mtime: 200,
      vertexCount: 20, faceCount: 10, dimensions: null, indexedAt: 10,
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].thumbnail, null);
    applyWatchedFileRecord(db, {
      path: '/models/a.stl', name: 'a', ext: 'stl', dir: '/models', size: 100, modifiedAt: 200,
      vertexCount: 20, faceCount: 10, dimensions: null, thumbnailPath: '/cache/a.png', thumbnailFailed: 0, indexedAt: 11,
    });
    assert.equal(received.length, 2);
    assert.equal(received[1].thumbnail, '/cache/a.png');
    assert.deepEqual(received.map((event) => event.mutation.affectedPaths), [['/models/a.stl'], ['/models/a.stl']]);
    unsubscribe();
    unsubscribeDuplicate();
  } finally {
    db.close();
  }
});
