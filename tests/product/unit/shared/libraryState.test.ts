import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LIBRARY_STATE,
  LIBRARY_STATE_STORAGE_KEY,
  normalizeLibraryState,
  serializeLibraryState,
  withAddedLibraryFolder,
  withRemovedLibraryFolder,
} from '../../../../src/shared/libraryState';

test('normalizeLibraryState deduplicates folders and aligns lastFolder', () => {
  const state = normalizeLibraryState({
    libraryFolders: ['/a', '/a', ' ', '/b', 123],
    lastFolder: '/missing',
  });

  assert.deepEqual(state.libraryFolders, ['/a', '/b']);
  assert.equal(state.lastFolder, '/a');
});

test('library state helpers update folders and lastFolder predictably', () => {
  const added = withAddedLibraryFolder(DEFAULT_LIBRARY_STATE, '/models');
  assert.deepEqual(added.libraryFolders, ['/models']);
  assert.equal(added.lastFolder, '/models');

  const removed = withRemovedLibraryFolder(added, '/models');
  assert.deepEqual(removed, DEFAULT_LIBRARY_STATE);
});

test('serializeLibraryState writes normalized localStorage payload', () => {
  const payload = serializeLibraryState({
    libraryFolders: ['/models', '/models'],
    lastFolder: '/models',
  });

  assert.equal(typeof payload, 'string');
  assert.equal(LIBRARY_STATE_STORAGE_KEY, 'polytray-library-state');
  assert.deepEqual(JSON.parse(payload), {
    libraryFolders: ['/models'],
    lastFolder: '/models',
  });
});
