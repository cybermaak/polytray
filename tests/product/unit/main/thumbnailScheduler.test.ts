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
