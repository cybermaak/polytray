import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHIVE_ENTRY_SEPARATOR,
  createArchiveEntryPath,
  getArchiveEntryBaseName,
  getArchiveEntryDirectory,
  getArchiveEntryExtension,
  isArchiveEntryPath,
  isSupportedArchiveEntry,
  normalizeArchiveEntryPath,
  parseArchiveEntryPath,
} from '../../../../src/shared/archivePaths';

test('archive entry helpers normalize and parse virtual paths', () => {
  const virtualPath = createArchiveEntryPath(
    '/library/bundle.zip',
    '\\models\\nested\\piece.stl',
  );

  assert.equal(
    virtualPath,
    `/library/bundle.zip${ARCHIVE_ENTRY_SEPARATOR}models/nested/piece.stl`,
  );
  assert.equal(isArchiveEntryPath(virtualPath), true);
  assert.deepEqual(parseArchiveEntryPath(virtualPath), {
    archivePath: '/library/bundle.zip',
    entryPath: 'models/nested/piece.stl',
  });
  assert.equal(getArchiveEntryDirectory(virtualPath), `/library/bundle.zip${ARCHIVE_ENTRY_SEPARATOR}models/nested`);
  assert.equal(getArchiveEntryBaseName('models/nested/piece.stl'), 'piece');
  assert.equal(getArchiveEntryExtension('models/nested/piece.stl'), 'stl');
  assert.equal(isSupportedArchiveEntry('models/nested/piece.stl'), true);
  assert.equal(isSupportedArchiveEntry('models/nested/readme.txt'), false);
  assert.equal(normalizeArchiveEntryPath('/nested/./mesh.obj'), 'nested/mesh.obj');
});
