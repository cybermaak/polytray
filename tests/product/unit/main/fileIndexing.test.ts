import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFileIndexRepository,
  applyScannedFileRecord,
  applyWatchedFileRecord,
  type CommittedFileMutation,
  mergeScannedFileRecord,
  mergeWatchedFileRecord,
  type IndexedFileRecord,
} from '../../../../src/main/fileIndexing';
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
    assert.deepEqual(db.prepare('SELECT scope_path FROM file_scopes').all(), [{ scope_path: '/' }, { scope_path: '/models' }]);

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
    assert.deepEqual(db.prepare('SELECT scope_path FROM file_scopes WHERE file_id = ? ORDER BY scope_path').all(first.id), [
      { scope_path: '/' }, { scope_path: '/models' },
    ]);

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
