import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildMetadataBackupV1,
  canonicalizeBackupPath,
  parseMetadataBackupSnapshot,
  serializeMetadataBackup,
  validateMetadataBackupV1,
} from '../../../../src/shared/metadataBackup';

test('metadata backup canonicalizes paths and keeps indexed and pending notes separate', () => {
  const document = buildMetadataBackupV1({
    exportedAt: '2026-09-26T12:00:00.000Z',
    appVersion: '1.1.1',
    indexedAnnotations: [{ path: '/library/../library/model.stl', tags: [' blue ', 'blue'], notes: 'Indexed note 🎨', printStatus: 'Printed' }],
    pendingAnnotations: [{ path: '/library/model.stl', tags: ['pending'], notes: 'Offline note', printStatus: 'Not Printed' }],
    snapshot: {
      rendererRevision: 9,
      libraryRoots: ['/library/../library', '/library'],
      collections: [{ id: 'c1', name: ' Favorites ', paths: ['/library/model.stl', '/library/archive.zip::entry::parts/part.obj'] }],
      preferences: { lightMode: true, gridSize: 'large', page_size: 500, slicerPath: '/Applications/hidden' } as never,
    },
  });

  assert.equal(document.annotations.length, 1);
  assert.deepEqual(document.annotations[0], {
    path: path.resolve('/library/model.stl'), tags: ['blue'], notes: 'Indexed note 🎨', printStatus: 'Printed',
  });
  assert.deepEqual(document.pendingAnnotations, [{
    path: path.resolve('/library/model.stl'), tags: ['pending'], notes: 'Offline note', printStatus: 'Not Printed',
  }]);
  assert.deepEqual(document.libraryRoots, [path.resolve('/library')]);
  assert.deepEqual(document.collections, [{
    id: 'c1', name: 'Favorites', paths: [path.resolve('/library/model.stl'), `${path.resolve('/library/archive.zip')}::entry::parts/part.obj`],
  }]);
  assert.equal(document.preferences.gridSize, 'large');
  assert.equal('autoScan' in document.preferences, false);
  assert.equal('page_size' in document.preferences, false);
  assert.equal('slicerPath' in document.preferences, false);
  assert.equal(document.manifest.sourceModelsIncluded, false);
  assert.ok(document.manifest.statement.includes('source model files are not included'));
});

test('runtime snapshot parser rejects malformed roots, collections, and portable preferences', () => {
  assert.throws(() => parseMetadataBackupSnapshot({ rendererRevision: 1, libraryRoots: 'nope', collections: [], preferences: {} }), /library roots/i);
  assert.throws(() => parseMetadataBackupSnapshot({ rendererRevision: 1, libraryRoots: [], collections: [{ id: 'x', name: 'x', paths: '/bad' }], preferences: {} }), /collection paths/i);
  assert.throws(() => parseMetadataBackupSnapshot({ rendererRevision: 1, libraryRoots: [], collections: [], preferences: { watch: 'yes' } }), /preference/i);
  assert.throws(() => buildMetadataBackupV1({
    exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1', indexedAnnotations: [], pendingAnnotations: [],
    snapshot: { rendererRevision: 1, libraryRoots: [''], collections: [], preferences: {} },
  }), /library roots/i);
});

test('archive-backed paths retain virtual identity while canonicalizing the archive path', () => {
  assert.equal(
    canonicalizeBackupPath('/library/../library/a.zip::entry::nested/./part.stl'),
    `${path.resolve('/library/a.zip')}::entry::nested/part.stl`,
  );
  assert.equal(canonicalizeBackupPath('/library/model.stl '), path.resolve('/library/model.stl '));
});

test('serialization is deterministic and validation rejects unsupported versions', () => {
  const document = buildMetadataBackupV1({
    exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1', indexedAnnotations: [], pendingAnnotations: [],
    snapshot: { rendererRevision: 0, libraryRoots: [], collections: [], preferences: {} },
  });
  const serialized = serializeMetadataBackup(document);
  assert.equal(serializeMetadataBackup(validateMetadataBackupV1(JSON.parse(serialized))), serialized);
  assert.throws(() => validateMetadataBackupV1({ ...document, version: 2 }), /version/i);
});

test('conflicting duplicate annotations within one source fail instead of dropping either note', () => {
  assert.throws(() => buildMetadataBackupV1({
    exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1',
    indexedAnnotations: [
      { path: '/library/model.stl', tags: ['first'], notes: 'first note' },
      { path: '/library/./model.stl', tags: ['second'], notes: 'second note' },
    ],
    pendingAnnotations: [],
    snapshot: { rendererRevision: 1, libraryRoots: [], collections: [], preferences: {} },
  }), /conflicting duplicate annotation notes/i);
});
