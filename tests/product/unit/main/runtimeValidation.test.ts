import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFolderPath,
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
