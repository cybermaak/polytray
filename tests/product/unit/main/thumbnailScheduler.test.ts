import test from 'node:test';
import assert from 'node:assert/strict';

import { createThumbnailJobScheduler } from '../../../../src/main/thumbnailJobScheduler';

test('thumbnail scheduler dedupes jobs by file path and runs single-flight', async () => {
  const calls: string[] = [];
  const scheduler = createThumbnailJobScheduler({
    async execute(job) {
      calls.push(job.filePath);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${job.filePath}.png`;
    },
  });

  const settings = {
    thumbnail_timeout: 1000,
    scanning_batch_size: 10,
    watcher_stability: 500,
    page_size: 100,
    thumbnailColor: '#8888aa',
  };

  const [a, b] = await Promise.all([
    scheduler.enqueue({
      filePath: '/models/cube.stl',
      ext: 'stl',
      settings,
      source: 'scan',
    }),
    scheduler.enqueue({
      filePath: '/models/cube.stl',
      ext: 'stl',
      settings,
      source: 'watch',
    }),
  ]);

  assert.equal(a, '/models/cube.stl.png');
  assert.equal(b, '/models/cube.stl.png');
  assert.deepEqual(calls, ['/models/cube.stl']);
});

test('thumbnail scheduler separates same-path requests with different explicit cache identities', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const firstGate = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = createThumbnailJobScheduler({
    async execute(job) {
      calls.push(job.dedupeKey ?? job.filePath);
      if (calls.length === 1) await firstGate;
      return `${job.dedupeKey}.png`;
    },
  });
  const settings = { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100, thumbnailColor: '#8888aa' };
  const first = scheduler.enqueue({ filePath: '/models/cube.stl', ext: 'stl', settings, source: 'scan', dedupeKey: 'revision-1' });
  const same = scheduler.enqueue({ filePath: '/models/cube.stl', ext: 'stl', settings, source: 'manual', dedupeKey: 'revision-1' });
  const newer = scheduler.enqueue({ filePath: '/models/cube.stl', ext: 'stl', settings, source: 'watch', dedupeKey: 'revision-2' });
  release();
  assert.deepEqual(await Promise.all([first, same, newer]), ['revision-1.png', 'revision-1.png', 'revision-2.png']);
  assert.deepEqual(calls, ['revision-1', 'revision-2']);
});
