import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFolderPath,
  parseLibraryQuery,
  parsePreviewMetric,
  parsePreviewParseCancelRequest,
  parsePreviewParseRequest,
  parsePreviewParseSettlementRequest,
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
      thumbQuality: '256',
    }),
    {
      thumbnail_timeout: 2500,
      scanning_batch_size: 10,
      watcher_stability: 500,
      page_size: 250,
      thumbnailColor: '#224466',
      thumbQuality: '256',
    },
  );
  assert.deepEqual(parsePreviewMetric({
    source: 'viewer', phase: 'first-render', filePath: '/tmp/dense.stl', ext: 'stl',
    durationMs: 28, renderSubmitMs: 7.5, meshCount: 1,
  }), {
    source: 'viewer', phase: 'first-render', filePath: '/tmp/dense.stl', ext: 'stl',
    durationMs: 28, renderSubmitMs: 7.5, meshCount: 1, payloadBytes: undefined,
  });
});

test('parseRuntimeSettings rejects invalid runtime settings', () => {
  assert.throws(
    () => parseRuntimeSettings({ thumbnail_timeout: 'fast' }),
    /Invalid runtime settings/,
  );
});

test('parseRuntimeSettings defaults older internal settings to the current thumbnail quality and rejects invalid quality', () => {
  assert.equal(parseRuntimeSettings({ thumbnail_timeout: 2500, scanning_batch_size: 10, watcher_stability: 500, page_size: 250, thumbnailColor: '#224466' }).thumbQuality, '256');
  assert.throws(() => parseRuntimeSettings({ thumbnail_timeout: 2500, scanning_batch_size: 10, watcher_stability: 500, page_size: 250, thumbnailColor: '#224466', thumbQuality: '1024' }), /Invalid runtime settings/);
});

test('path and preview validators reject malformed IPC payloads', () => {
  assert.equal(parseFolderPath('/models'), '/models');
  assert.equal(parseThumbnailPath('/tmp/thumb.png'), '/tmp/thumb.png');
  assert.deepEqual(
    parsePreviewParseRequest({
      requestId: 'abc',
      path: '/tmp/model.3mf',
      extension: '3MF',
      contentRevision: 8,
    }),
    {
      requestId: 'abc',
      path: '/tmp/model.3mf',
      extension: '3mf',
      contentRevision: 8,
    },
  );
  assert.deepEqual(
    parsePreviewParseCancelRequest({ requestId: 'abc', reason: 'replaced' }),
    { requestId: 'abc', reason: 'replaced' },
  );
  assert.deepEqual(parsePreviewParseSettlementRequest({ requestId: 'abc' }), { requestId: 'abc' });
  assert.throws(
    () => parsePreviewParseSettlementRequest({ requestId: 'abc', preview: { meshes: [] } }),
    /Invalid preview parse settlement/,
  );
  assert.throws(
    () => parsePreviewParseSettlementRequest({ requestId: 'abc', error: 'x'.repeat(2049) }),
    /Invalid preview parse settlement/,
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
      renderSubmitMs: undefined,
    },
  );

  assert.throws(() => parseFolderPath(''), /Invalid folder path/);
  assert.throws(() => parseThumbnailPath(42), /Invalid thumbnail path/);
  assert.throws(
    () => parsePreviewParseRequest({ requestId: 'abc' }),
    /Invalid preview parse request/,
  );
  assert.throws(
    () => parsePreviewParseRequest({ requestId: 'abc', path: 'relative.3mf', extension: '3mf', contentRevision: 0 }),
    /Invalid preview parse request/,
  );
  assert.throws(
    () => parsePreviewParseRequest({ requestId: 'abc', path: '/tmp/model.3mf', extension: '3mf', contentRevision: -1 }),
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
