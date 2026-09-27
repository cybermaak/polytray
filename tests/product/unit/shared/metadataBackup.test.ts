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
    `${path.resolve('/library/a.zip')}::entry::nested/./part.stl`,
  );
  assert.equal(canonicalizeBackupPath('/library/model.stl '), path.resolve('/library/model.stl '));
});

test('ZIP member dot-dot segments and case remain separate annotation identities', () => {
  const archive = path.resolve('/library/models.zip');
  const first = `${archive}::entry::a/../Parts/Model.stl`;
  const second = `${archive}::entry::Parts/Model.stl`;
  const document = buildMetadataBackupV1({
    exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1',
    indexedAnnotations: [
      { path: first, tags: ['first'], notes: 'first bytes' },
      { path: second, tags: ['second'], notes: 'second bytes' },
    ],
    pendingAnnotations: [],
    snapshot: { rendererRevision: 1, libraryRoots: ['/library'], collections: [], preferences: {} },
  });
  assert.equal(document.annotations.length, 2);
  assert.equal(document.annotations.some((entry) => entry.path === first && entry.notes === 'first bytes'), true);
  assert.equal(document.annotations.some((entry) => entry.path === second && entry.notes === 'second bytes'), true);
});

test('foreign absolute paths are retained and ambiguous relative paths are rejected', () => {
  const windowsDrivePath = 'C:\\Users\\Maker\\models\\part.stl';
  const uncPath = '\\\\nasbox\\Models\\part.stl';
  assert.equal(canonicalizeBackupPath(windowsDrivePath), path.win32.normalize(windowsDrivePath));
  assert.equal(canonicalizeBackupPath(uncPath), path.win32.normalize(uncPath));
  assert.throws(() => canonicalizeBackupPath('relative/models/part.stl'), /absolute/i);
  assert.throws(() => canonicalizeBackupPath('relative.zip::entry::part.stl'), /absolute/i);
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

test('V1 import validation bounds raw input bytes and combined annotation entries', () => {
  assert.throws(() => validateMetadataBackupV1(new Uint8Array(50 * 1024 * 1024 + 1)), /50 MiB/i);
  assert.throws(() => validateMetadataBackupV1(' '.repeat(50 * 1024 * 1024 + 1)), /50 MiB/i);
  const document = buildMetadataBackupV1({
    exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1', indexedAnnotations: [], pendingAnnotations: [],
    snapshot: { rendererRevision: 0, libraryRoots: [], collections: [], preferences: {} },
  });
  assert.throws(() => validateMetadataBackupV1({ ...document,
    annotations: new Array(125001).fill({ path: '/a', tags: [], notes: null }),
    pendingAnnotations: new Array(125000).fill({ path: '/b', tags: [], notes: null }),
  }), /250,?000/i);
});

test('V1 import defaults absent pending records and rejects duplicate canonical identities per array', () => {
  const document = buildMetadataBackupV1({
    exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1', indexedAnnotations: [], pendingAnnotations: [],
    snapshot: { rendererRevision: 0, libraryRoots: [], collections: [], preferences: {} },
  });
  const { pendingAnnotations: _pending, ...legacy } = document;
  assert.deepEqual(validateMetadataBackupV1(legacy).pendingAnnotations, []);
  assert.throws(() => validateMetadataBackupV1({ ...document, annotations: [
    { path: '/models/a.stl', tags: [], notes: null }, { path: '/models/./a.stl', tags: [], notes: null },
  ] }), /duplicate/i);
  assert.throws(() => validateMetadataBackupV1({ ...document, version: 99 }), /version/i);
  assert.throws(() => validateMetadataBackupV1('{not json'), /malformed/i);
  assert.throws(() => validateMetadataBackupV1({ ...document, annotations: [{ path: 'relative.stl', tags: [], notes: null }] }), /absolute/i);
  assert.throws(() => validateMetadataBackupV1({ ...document, collections: [{ id: '', name: 'x', paths: [] }] }), /collections/i);
  assert.throws(() => validateMetadataBackupV1({ ...document, preferences: { watch: 'sometimes' } }), /preference/i);
});
