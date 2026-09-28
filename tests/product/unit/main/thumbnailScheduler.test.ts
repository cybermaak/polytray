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

test('thumbnail scheduler preserves manual, watch, background priority across repeated queue starts', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = createThumbnailJobScheduler({
    async execute(job) {
      calls.push(job.filePath);
      if (calls.length === 1) await gate;
      return job.filePath;
    },
  });
  const settings = { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100, thumbnailColor: '#8888aa' };
  const first = scheduler.enqueue({ filePath: '/first.stl', ext: 'stl', settings, source: 'scan' });
  const queuedBackground = scheduler.enqueue({ filePath: '/background.stl', ext: 'stl', settings, source: 'scan' });
  const queuedWatch = scheduler.enqueue({ filePath: '/watch.stl', ext: 'stl', settings, source: 'watch' });
  const queuedManual = scheduler.enqueue({ filePath: '/manual.stl', ext: 'stl', settings, source: 'manual' });
  void scheduler.getStats(); // repeated queue starts must not create a second runner
  release();
  await Promise.all([first, queuedBackground, queuedWatch, queuedManual]);
  assert.deepEqual(calls, ['/first.stl', '/manual.stl', '/watch.stl', '/background.stl']);
});

test('thumbnail scheduler retries null results once and reports failure rather than success', async () => {
  let calls = 0;
  const scheduler = createThumbnailJobScheduler({ execute: async () => { calls += 1; return null; } });
  const settings = { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100, thumbnailColor: '#8888aa' };
  await assert.rejects(scheduler.enqueue({ filePath: '/null.stl', ext: 'stl', settings, source: 'scan', retries: 9 }), /no image/);
  assert.equal(calls, 2);
  assert.equal(scheduler.getStats().failed, 1);
  assert.equal(scheduler.getStats().completed, 0);
});

test('thumbnail cancellation settles active and queued consumers without retrying or failing them', async () => {
  const calls: string[] = [];
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const scheduler = createThumbnailJobScheduler({ execute: async (job) => {
    calls.push(job.filePath);
    started();
    await new Promise<void>((resolve) => {
      if (job.controller.signal.aborted) return resolve();
      job.controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return null;
  } });
  const settings = { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100, thumbnailColor: '#8888aa' };
  const batch = scheduler.enqueueBatch([
    { filePath: '/active.stl', ext: 'stl', settings, source: 'scan' },
    { filePath: '/queued.stl', ext: 'stl', settings, source: 'scan' },
  ]);
  await startedPromise;
  await scheduler.cancel(batch.jobId);
  await batch.done;
  assert.deepEqual(calls, ['/active.stl']);
  assert.equal(scheduler.getStats().retries, 0);
  assert.equal(scheduler.getStats().failed, 0);
  assert.equal(scheduler.getStats().active, 0);
  const snapshot = scheduler.getJobs().find((job) => job.jobId === batch.jobId)!;
  assert.equal(snapshot.state, 'cancelled');
  assert.equal(snapshot.counts.thumbnailsPending, 0);
  assert.equal(snapshot.counts.thumbnailsFailed, 0);
});

test('thumbnail batch pause acknowledges only after the active item and keeps remaining work pending', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = createThumbnailJobScheduler({ execute: async (job) => {
    calls.push(job.filePath);
    if (calls.length === 1) await gate;
    return `${job.filePath}.png`;
  } });
  const settings = { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100, thumbnailColor: '#8888aa' };
  const batch = scheduler.enqueueBatch([
    { filePath: '/one.stl', ext: 'stl', settings, source: 'scan' },
    { filePath: '/two.stl', ext: 'stl', settings, source: 'scan' },
  ]);
  const pause = scheduler.pause(batch.jobId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  release();
  await pause;
  assert.equal(calls.length, 1);
  assert.equal(scheduler.getJobs().find((job) => job.jobId === batch.jobId)?.state, 'paused');
  await scheduler.resume(batch.jobId);
  await batch.done;
  assert.deepEqual(calls, ['/one.stl', '/two.stl']);
});

test('thumbnail batch cancellation settles queued consumers and retry failures queues failed keys only', async () => {
  const calls: string[] = [];
  let firstAttempt = true;
  const scheduler = createThumbnailJobScheduler({ execute: async (job) => {
    calls.push(job.filePath);
    if (job.filePath === '/bad.stl' && firstAttempt) { firstAttempt = false; throw new Error('parse failed'); }
    return `${job.filePath}.png`;
  } });
  const settings = { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100, thumbnailColor: '#8888aa' };
  const batch = scheduler.enqueueBatch([
    { filePath: '/ok.stl', ext: 'stl', settings, source: 'scan' },
    { filePath: '/bad.stl', ext: 'stl', settings, source: 'scan', retries: 0 },
  ]);
  await batch.done;
  const before = calls.length;
  await scheduler.retryFailures(batch.jobId);
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1), '/bad.stl');
  const snapshot = scheduler.getJobs().find((job) => job.jobId === batch.jobId)!;
  assert.equal(snapshot.counts.thumbnailsSucceeded, 2);
  assert.equal(snapshot.counts.thumbnailsFailed, 0);
  assert.equal(snapshot.counts.thumbnailsPending, 0);
});
