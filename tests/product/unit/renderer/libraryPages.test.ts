import test from 'node:test';
import assert from 'node:assert/strict';
import type { FileRecord } from '../../../../src/shared/types';
import type { LibraryItem, LibraryPageResult } from '../../../../src/shared/libraryQuery';
import {
  createInitialLibraryPagesState,
  libraryPagesReducer,
} from '../../../../src/renderer/hooks/useLibraryPages';

function file(id: number): LibraryItem {
  const record: FileRecord = {
    id,
    path: `/library/${id}.stl`,
    name: `${id}.stl`,
    extension: 'stl',
    directory: '/library',
    size_bytes: 10,
    modified_at: id,
    vertex_count: 3,
    face_count: 1,
    thumbnail: null,
    thumbnail_failed: 0,
    indexed_at: id,
    content_revision: 1,
    archive_path: null,
  };
  return { kind: 'file', key: `file:${id}`, file: record };
}

function okPage(
  revision: number,
  items: LibraryItem[],
  nextOffset: number | null,
  totalItems = 600,
): LibraryPageResult {
  return { status: 'ok', revision, items, totalItems, totalModels: 600, nextOffset };
}

test('new query generations ignore an older request that completes late', () => {
  let state = createInitialLibraryPagesState();
  state = libraryPagesReducer(state, { type: 'query-started', generation: 2, queryKey: 'search:new' });
  state = libraryPagesReducer(state, {
    type: 'page-loaded', generation: 1, offset: 0, page: okPage(1, [file(1)], null),
  });
  assert.equal(state.queryKey, 'search:new');
  assert.deepEqual(state.items, []);
});

test('page append deduplicates stable item keys and keeps total counts independent of loaded rows', () => {
  let state = createInitialLibraryPagesState();
  state = libraryPagesReducer(state, { type: 'query-started', generation: 1, queryKey: 'all' });
  state = libraryPagesReducer(state, { type: 'page-loaded', generation: 1, offset: 0, page: okPage(8, [file(1), file(2)], 500) });
  state = libraryPagesReducer(state, { type: 'page-loaded', generation: 1, offset: 500, page: okPage(8, [file(2), file(3)], null) });
  assert.deepEqual(state.items.map((item) => item.key), ['file:1', 'file:2', 'file:3']);
  assert.equal(state.totalItems, 600);
  assert.equal(state.totalModels, 600);
  assert.equal(state.nextOffset, null);
  assert.equal(state.revision, 8);
});

test('a failed next page remains retryable at the same offset', () => {
  let state = createInitialLibraryPagesState();
  state = libraryPagesReducer(state, { type: 'query-started', generation: 1, queryKey: 'all' });
  state = libraryPagesReducer(state, { type: 'page-loaded', generation: 1, offset: 0, page: okPage(5, [file(1)], 500) });
  state = libraryPagesReducer(state, { type: 'page-failed', generation: 1, offset: 500, error: 'temporary failure' });
  assert.equal(state.nextOffset, 500);
  assert.equal(state.error?.offset, 500);
  state = libraryPagesReducer(state, { type: 'page-loaded', generation: 1, offset: 500, page: okPage(5, [file(2)], null) });
  assert.deepEqual(state.items.map((item) => item.key), ['file:1', 'file:2']);
  assert.equal(state.error, null);
});

test('a page from another browse revision is rejected and requests a same-scope refresh', () => {
  let state = createInitialLibraryPagesState();
  state = libraryPagesReducer(state, { type: 'query-started', generation: 1, queryKey: 'all' });
  state = libraryPagesReducer(state, { type: 'page-loaded', generation: 1, offset: 0, page: okPage(10, [file(1)], 500) });
  state = libraryPagesReducer(state, { type: 'page-loaded', generation: 1, offset: 500, page: okPage(11, [file(2)], null) });
  assert.deepEqual(state.items.map((item) => item.key), ['file:1']);
  assert.equal(state.revision, 10);
  assert.equal(state.refreshRequired, true);
});

test('same-scope refresh atomically replaces loaded items at the new revision', () => {
  let state = createInitialLibraryPagesState();
  state = libraryPagesReducer(state, { type: 'query-started', generation: 1, queryKey: 'all' });
  state = libraryPagesReducer(state, { type: 'page-loaded', generation: 1, offset: 0, page: okPage(10, [file(1), file(2)], 500) });
  state = libraryPagesReducer(state, { type: 'refresh-started', generation: 1 });
  assert.deepEqual(state.items.map((item) => item.key), ['file:1', 'file:2']);
  state = libraryPagesReducer(state, {
    type: 'refresh-completed', generation: 1,
    items: [file(2), file(3)], revision: 11, totalItems: 600, totalModels: 600, nextOffset: 500,
  });
  assert.deepEqual(state.items.map((item) => item.key), ['file:2', 'file:3']);
  assert.equal(state.revision, 11);
  assert.equal(state.refreshRequired, false);
});
