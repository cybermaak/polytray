import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFolderPath,
  parseLibraryQuery,
  parsePreviewMetric,
  parsePreviewParseRequest,
  parseRuntimeSettings,
  parseThumbnailPath,
} from '../../../../src/main/ipc/runtimeValidation';

test('parseRuntimeSettings normalizes valid runtime settings', () => {
  assert.deepEqual(
    parseRuntimeSettings({
      thumbnail_timeout: 2500,
      scanning_batch_size: 10,
      watcher_stability: 500,
      page_size: 250,
      thumbnailColor: '#224466',
    }),
    {
      thumbnail_timeout: 2500,
      scanning_batch_size: 10,
      watcher_stability: 500,
      page_size: 250,
      thumbnailColor: '#224466',
    },
  );
});

test('parseRuntimeSettings rejects invalid runtime settings', () => {
  assert.throws(
    () => parseRuntimeSettings({ thumbnail_timeout: 'fast' }),
    /Invalid runtime settings/,
  );
});

test('path and preview validators reject malformed IPC payloads', () => {
  assert.equal(parseFolderPath('/models'), '/models');
  assert.equal(parseThumbnailPath('/tmp/thumb.png'), '/tmp/thumb.png');
  assert.deepEqual(
    parsePreviewParseRequest({
      requestId: 'abc',
      filePath: '/tmp/model.3mf',
      ext: '3mf',
    }),
    {
      requestId: 'abc',
      filePath: '/tmp/model.3mf',
      ext: '3mf',
    },
  );
  assert.deepEqual(
    parsePreviewMetric({
      source: 'hidden-renderer',
      phase: 'parse',
      filePath: '/tmp/model.3mf',
      ext: '3MF',
      durationMs: 123.4,
      meshCount: 5,
      payloadBytes: 2048,
    }),
    {
      source: 'hidden-renderer',
      phase: 'parse',
      filePath: '/tmp/model.3mf',
      ext: '3mf',
      durationMs: 123.4,
      meshCount: 5,
      payloadBytes: 2048,
    },
  );

  assert.throws(() => parseFolderPath(''), /Invalid folder path/);
  assert.throws(() => parseThumbnailPath(42), /Invalid thumbnail path/);
  assert.throws(
    () => parsePreviewParseRequest({ requestId: 'abc' }),
    /Invalid preview parse request/,
  );
  assert.throws(
    () => parsePreviewMetric({ source: 'worker', phase: 'parse' }),
    /Invalid preview metric/,
  );
});

test('parseLibraryQuery supplies bounded defaults and preserves collection and archive identity', () => {
  assert.deepEqual(parseLibraryQuery({}), {
    sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
    collectionPaths: null, limit: 500, offset: 0, archivePath: null,
  });
  assert.deepEqual(parseLibraryQuery({
    sort: 'faces', direction: 'DESC', extension: 'STL', folder: '/models', search: 'literal%_',
    collectionPaths: [], limit: 20, offset: 40, expectedBrowseRevision: 7,
    archivePath: '/models/kits.zip',
  }), {
    sort: 'faces', direction: 'DESC', extension: 'stl', folder: '/models', search: 'literal%_',
    collectionPaths: [], limit: 20, offset: 40, expectedBrowseRevision: 7,
    archivePath: '/models/kits.zip',
  });
  const opaqueMemberPath = '/models/kits.zip::entry::a/../Part.stl';
  assert.equal(parseLibraryQuery({ collectionPaths: [opaqueMemberPath] }).collectionPaths?.[0], opaqueMemberPath);
});

test('parseLibraryQuery rejects unsafe sorts, directions, limits, offsets, revisions, and paths', () => {
  for (const input of [
    { sort: 'drop table' }, { direction: 'sideways' }, { limit: 0 }, { limit: 2001 },
    { limit: 1.5 }, { offset: -1 }, { offset: Number.MAX_SAFE_INTEGER + 1 },
    { expectedBrowseRevision: -1 }, { expectedBrowseRevision: Number.MAX_SAFE_INTEGER + 1 },
    { search: null }, { folder: '' }, { extension: '' }, { archivePath: '' },
    { collectionPaths: [''] }, { collectionPaths: 'not-a-list' },
  ]) {
    assert.throws(() => parseLibraryQuery(input), /Invalid library query/);
  }
});
