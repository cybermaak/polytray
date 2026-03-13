import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeScannedFileRecord,
  mergeWatchedFileRecord,
  type IndexedFileRecord,
} from '../../../../src/main/fileIndexing';

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
      indexedAt: 6000,
    },
  );

  assert.equal(merged.name, 'a-new');
  assert.equal(merged.thumbnailPath, null);
  assert.equal(merged.thumbnailFailed, 0);
  assert.equal(merged.indexedAt, 6000);
});

test('watcher merge does not overwrite a newer scanned record', () => {
  const merged = mergeWatchedFileRecord(
    makeExistingRecord({
      name: 'scan-new',
      modifiedAt: 300,
      vertexCount: 40,
      faceCount: 20,
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
      thumbnailPath: '/watch-thumb.png',
      thumbnailFailed: 0,
      indexedAt: 6500,
    },
  );

  assert.equal(merged.name, 'scan-new');
  assert.equal(merged.modifiedAt, 300);
  assert.equal(merged.thumbnailPath, null);
  assert.equal(merged.indexedAt, 7000);
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
    thumbnailPath: '/watch-thumb.png',
    thumbnailFailed: 0,
    indexedAt: 7200,
  });

  assert.equal(merged.name, 'watch-new');
  assert.equal(merged.thumbnailPath, '/watch-thumb.png');
  assert.equal(merged.modifiedAt, 320);
  assert.equal(merged.indexedAt, 7200);
});
