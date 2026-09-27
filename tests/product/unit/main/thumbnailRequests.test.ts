import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailRequestRegistry, createThumbnailAttemptRegistry, createThumbnailIdentity } from '../../../../src/main/thumbnailIdentity';

test('settled cache hits leave no retained request promise', async () => {
  const registry = createThumbnailRequestRegistry();
  let exists = true;
  let generated = 0;
  const request = () => registry.run('key', async () => {
    if (exists) return '/cache/model.png';
    generated++;
    return '/cache/model.png';
  });

  assert.equal(await request(), '/cache/model.png');
  exists = false;
  assert.equal(registry.size, 0);
  assert.equal(await request(), '/cache/model.png');
  assert.equal(generated, 1);
});

test('identical requests share one result while different content revisions do not', async () => {
  const registry = createThumbnailRequestRegistry();
  const first = createThumbnailIdentity('/models/a.stl', 1, '#AABBCC', 256);
  const second = createThumbnailIdentity('/models/a.stl', 2, '#AABBCC', 256);
  let release!: (value: string) => void;
  const gate = new Promise<string>((resolve) => { release = resolve; });
  let calls = 0;
  const request = (key: string) => registry.run(key, async () => { calls++; return gate; });

  const a = request(first.key);
  const b = request(first.key);
  const newer = request(second.key);
  await Promise.resolve();
  assert.equal(calls, 2);
  release('/cache/result.png');
  assert.deepEqual(await Promise.all([a, b, newer]), ['/cache/result.png', '/cache/result.png', '/cache/result.png']);
});

test('timeout and renderer result race settles an attempt exactly once', async () => {
  const attempts = createThumbnailAttemptRegistry();
  let settled = 0;
  const attempt = { requestId: 'attempt-1', cacheEpoch: 1, key: createThumbnailIdentity('/models/a.stl', 1, '#123456', 128).identity };
  attempts.register(attempt, () => { settled++; });
  assert.equal(attempts.settle(attempt.requestId, '/cache/a.png'), true);
  assert.equal(attempts.settle(attempt.requestId, null), false);
  await new Promise<void>((resolve) => setTimeout(() => {
    assert.equal(attempts.settle(attempt.requestId, null), false);
    resolve();
  }, 0));
  assert.equal(settled, 1);
  assert.equal(attempts.size, 0);
});

test('epoch invalidation settles all attempts for only the matching indexed path', () => {
  const attempts = createThumbnailAttemptRegistry<string | null>();
  let cancelled = 0;
  const first = { requestId: 'one', cacheEpoch: 0, key: createThumbnailIdentity('/models/a.stl', 1, '#123456', 128).cacheKey };
  const other = { requestId: 'two', cacheEpoch: 0, key: createThumbnailIdentity('/models/b.stl', 1, '#123456', 128).cacheKey };
  attempts.register(first, () => { cancelled++; });
  attempts.register(other, () => { cancelled++; });
  assert.equal(attempts.settleWhere((attempt) => attempt.key.canonicalPath === first.key.canonicalPath, null), 1);
  assert.equal(cancelled, 1);
  assert.equal(attempts.size, 1);
});

test('thumbnail identity changes when path, revision, color, or size changes', () => {
  const baseline = createThumbnailIdentity('/models/a.stl', 1, '#abcdef', 128);
  assert.notEqual(createThumbnailIdentity('/models/b.stl', 1, '#abcdef', 128).key, baseline.key);
  assert.notEqual(createThumbnailIdentity('/models/a.stl', 2, '#abcdef', 128).key, baseline.key);
  assert.notEqual(createThumbnailIdentity('/models/a.stl', 1, '#fedcba', 128).key, baseline.key);
  assert.notEqual(createThumbnailIdentity('/models/a.stl', 1, '#abcdef', 256).key, baseline.key);
});
