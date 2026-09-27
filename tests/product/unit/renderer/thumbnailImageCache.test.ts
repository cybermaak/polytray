import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  markThumbnailImageDecodeFailed,
  ThumbnailImage,
  type ResolvedThumbnailImage,
} from '../../../../src/renderer/components/ThumbnailImage';
import {
  createThumbnailImageCache,
  watchThumbnailImage,
} from '../../../../src/renderer/lib/thumbnailImageCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const image = (payload: string) => `data:image/png;base64,${payload}`;

test('concurrent consumers share one approved cache-path read', async () => {
  const response = deferred<string | null>();
  const reads: string[] = [];
  const cache = createThumbnailImageCache((thumbnailPath) => {
    reads.push(thumbnailPath);
    return response.promise;
  });

  const first = cache.load('/cache/model.png', 7);
  const second = cache.load('/cache/model.png', 7);
  await Promise.resolve();
  assert.deepEqual(reads, ['/cache/model.png']);
  response.resolve(image('AQID'));
  assert.equal(await first, image('AQID'));
  assert.equal(await second, image('AQID'));
  assert.equal(await cache.load('/cache/model.png', 7), image('AQID'));
  assert.deepEqual(reads, ['/cache/model.png']);
});

test('identity separates content revisions that reuse the same cache path', async () => {
  let reads = 0;
  const cache = createThumbnailImageCache(async () => {
    reads++;
    return image(reads === 1 ? 'AAAA' : 'BBBB');
  });

  assert.equal(await cache.load('/cache/model.png', 1), image('AAAA'));
  assert.equal(await cache.load('/cache/model.png', 2), image('BBBB'));
  assert.equal(await cache.load('/cache/model.png', 1), image('AAAA'));
  assert.equal(reads, 2);
});

test('data URLs are never sent to the main-process thumbnail reader', async () => {
  const reads: string[] = [];
  const cache = createThumbnailImageCache(async (thumbnailPath) => {
    reads.push(thumbnailPath);
    return image('AQID');
  });

  assert.equal(await cache.load('data:image/png;base64,AQID'), null);
  assert.equal(await cache.load('DATA:image/png;base64,AQID'), null);
  assert.deepEqual(reads, []);
});

test('missing and rejected reads stay uncached and can be retried', async () => {
  let attempts = 0;
  const cache = createThumbnailImageCache(async () => {
    attempts++;
    if (attempts === 1) return null;
    if (attempts === 2) throw new Error('cache read failed');
    return image('BAUG');
  });

  assert.equal(await cache.load('/cache/retry.png'), null);
  assert.equal(await cache.load('/cache/retry.png'), null);
  assert.equal(await cache.load('/cache/retry.png'), image('BAUG'));
  assert.equal(attempts, 3);
});

test('LRU limits use recency and encoded bytes', async () => {
  const reads: string[] = [];
  const cache = createThumbnailImageCache(async (thumbnailPath) => {
    reads.push(thumbnailPath);
    return image(thumbnailPath.endsWith('a.png') ? 'AAAA' : 'BBBB');
  }, { maxEntries: 2, maxEncodedBytes: 128 });

  await cache.load('/cache/a.png');
  await cache.load('/cache/b.png');
  await cache.load('/cache/a.png'); // Make a the most recently used entry.
  await cache.load('/cache/c.png'); // Evicts b.
  await cache.load('/cache/a.png');
  await cache.load('/cache/b.png');
  assert.deepEqual(reads, ['/cache/a.png', '/cache/b.png', '/cache/c.png', '/cache/b.png']);

  const byteLimitedReads: string[] = [];
  const largeImage = image('A'.repeat(40));
  const byteLimited = createThumbnailImageCache(async (thumbnailPath) => {
    byteLimitedReads.push(thumbnailPath);
    return largeImage;
  }, { maxEntries: 8, maxEncodedBytes: largeImage.length - 1 });
  assert.equal(await byteLimited.load('/cache/large.png'), largeImage);
  assert.equal(await byteLimited.load('/cache/large.png'), largeImage);
  assert.equal(byteLimitedReads.length, 2);
});

test('invalidation fences an in-flight result and allows a fresh read for the same key', async () => {
  const oldRead = deferred<string | null>();
  const newRead = deferred<string | null>();
  let reads = 0;
  const cache = createThumbnailImageCache(async () => {
    reads++;
    return reads === 1 ? oldRead.promise : newRead.promise;
  });

  const stale = cache.load('/cache/model.png', 'revision-1');
  cache.invalidate('/cache/model.png');
  const fresh = cache.load('/cache/model.png', 'revision-1');
  await Promise.resolve();
  assert.equal(reads, 2);
  newRead.resolve(image('TkVX'));
  assert.equal(await fresh, image('TkVX'));
  oldRead.resolve(image('T0xE'));
  assert.equal(await stale, null);
  assert.equal(await cache.load('/cache/model.png', 'revision-1'), image('TkVX'));
  assert.equal(reads, 2);
});

test('path invalidation retries a missing thumbnail for a still-mounted consumer', async () => {
  let reads = 0;
  const cache = createThumbnailImageCache(async () => {
    reads++;
    return reads === 1 ? null : image('AQID');
  });
  const updates: Array<string | null> = [];
  const unsubscribe = watchThumbnailImage(cache, '/cache/regenerated.png', 4, (value) => {
    updates.push(value);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(updates.at(-1), null);

  // A later ready event for the same path/revision invalidates the prior miss.
  cache.invalidate('/cache/regenerated.png');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 2);
  assert.equal(updates.at(-1), image('AQID'));
  unsubscribe();
});

test('request sessions ignore completion after path replacement or unmount', async () => {
  const oldRead = deferred<string | null>();
  const newRead = deferred<string | null>();
  const cache = createThumbnailImageCache((thumbnailPath) =>
    thumbnailPath.endsWith('old.png') ? oldRead.promise : newRead.promise,
  );
  const updates: Array<{ path: string; value: string | null }> = [];

  const stopOld = watchThumbnailImage(cache, '/cache/old.png', 1, (value) => {
    updates.push({ path: 'old', value });
  });
  stopOld(); // React effect cleanup when the path changes.
  const stopNew = watchThumbnailImage(cache, '/cache/new.png', 2, (value) => {
    updates.push({ path: 'new', value });
  });
  await Promise.resolve();
  oldRead.resolve(image('T0xE'));
  newRead.resolve(image('TkVX'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(updates.some((update) => update.path === 'old' && update.value !== null), false);
  assert.equal(updates.some((update) => update.path === 'new' && update.value === image('TkVX')), true);

  const unmountRead = deferred<string | null>();
  const unmountCache = createThumbnailImageCache(() => unmountRead.promise);
  const unmountedUpdates: Array<string | null> = [];
  const unmount = watchThumbnailImage(unmountCache, '/cache/unmounted.png', undefined, (value) => {
    unmountedUpdates.push(value);
  });
  await Promise.resolve();
  unmount();
  const updatesAtUnmount = unmountedUpdates.length;
  unmountRead.resolve(image('TEFURQ=='));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(unmountedUpdates.length, updatesAtUnmount);
  stopNew();
});

test('component keeps a same-size accessible placeholder and defaults to decorative alt text', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ThumbnailImage, {
      thumbnailPath: null,
      className: 'card-thumbnail-image',
      style: { width: 64, height: 64 },
    }),
  );
  assert.match(markup, /<img/);
  assert.match(markup, /alt=""/);
  assert.match(markup, /width:64px;height:64px/);
});

test('component renders a safe placeholder when the thumbnail path is undefined', () => {
  const markup = renderToStaticMarkup(React.createElement(ThumbnailImage, {}));
  assert.match(markup, /data-thumbnail-state="placeholder"/);
  assert.match(markup, /alt=""/);
});

test('decode errors replace only the current source with a placeholder without retrying it', async () => {
  const broken = image('AQID');
  const current: ResolvedThumbnailImage = {
    path: '/cache/broken.png', identity: 4, dataUrl: broken,
  };
  const failed = markThumbnailImageDecodeFailed(current, '/cache/broken.png', 4, broken);
  assert.deepEqual(failed, { ...current, dataUrl: null });
  assert.equal(markThumbnailImageDecodeFailed(current, '/cache/broken.png', 5, broken), current);
  assert.equal(markThumbnailImageDecodeFailed(current, '/cache/broken.png', 4, image('BAUG')), current);

  let reads = 0;
  const cache = createThumbnailImageCache(async () => { reads++; return broken; });
  await cache.load('/cache/broken.png', 4);
  await cache.load('/cache/broken.png', 4); // Decode fallback does not trigger an automatic retry loop.
  assert.equal(reads, 1);
});
