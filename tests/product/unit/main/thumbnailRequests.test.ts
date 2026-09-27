import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailRequestRegistry, createThumbnailAttemptRegistry, createThumbnailIdentity, generateForCapturedThumbnailIdentity, readValidatedThumbnailCache, thumbnailRequestKey } from '../../../../src/main/thumbnailIdentity';

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

test('an invalidation followed immediately by a new request does not join the old epoch promise', async () => {
  const registry = createThumbnailRequestRegistry<string | null>();
  const cacheIdentity = createThumbnailIdentity('/models/a.stl', 1, '#123456', 128).key;
  let epoch = 0;
  let releaseOld!: (value: string | null) => void;
  const oldGate = new Promise<string | null>((resolve) => { releaseOld = resolve; });
  let started = 0;
  const request = () => registry.run(thumbnailRequestKey(cacheIdentity, epoch), async () => {
    started++;
    return epoch === 0 ? oldGate : '/cache/new.png';
  });

  const oldRequest = request();
  await Promise.resolve();
  epoch++;
  const newRequest = request();
  assert.equal(await newRequest, '/cache/new.png');
  releaseOld(null);
  assert.equal(await oldRequest, null);
  assert.equal(started, 2);
});

test('cache reads reject stale identities after async IO and require decoded requested dimensions', async () => {
  let finishRead!: (value: Buffer) => void;
  let current = true;
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const read = readValidatedThumbnailCache(
    () => new Promise<Buffer>((resolve) => { finishRead = resolve; }),
    128,
    () => ({ width: 128, height: 128 }),
    async () => current,
  );
  current = false;
  finishRead(bytes);
  assert.equal(await read, null);

  const wrongDimensions = await readValidatedThumbnailCache(async () => bytes, 256, () => ({ width: 128, height: 128 }), async () => true);
  const invalidPng = await readValidatedThumbnailCache(async () => Buffer.from('89504e470d0a1a0a', 'hex'), 128, () => null, async () => true);
  assert.equal(wrongDimensions, null);
  assert.equal(invalidPng, null);
});

test('manual publication uses the identity captured before generation', async () => {
  let currentRevision = 3;
  const published: number[] = [];
  const result = await generateForCapturedThumbnailIdentity(
    () => ({ id: 1, path: '/models/a.stl', contentRevision: currentRevision }),
    async (captured) => {
      assert.equal(captured.contentRevision, 3);
      currentRevision = 4;
      return '/cache/revision-3.png';
    },
    async (captured, thumbnailPath) => {
      if (captured.contentRevision !== currentRevision) return false;
      published.push(captured.contentRevision);
      return thumbnailPath !== null;
    },
  );
  assert.equal(result, null);
  assert.deepEqual(published, []);
});

test('timeout and renderer result race settles an attempt exactly once', async () => {
  const attempts = createThumbnailAttemptRegistry();
  let settled = 0;
  const attempt = { requestId: 'attempt-1', cacheEpoch: 1, key: createThumbnailIdentity('/models/a.stl', 1, '#123456', 128).cacheKey };
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
