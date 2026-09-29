import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundJobCommandRouter, registerBackgroundJobCommandHandlers } from '../../../../src/main/backgroundJobCommands';
import type { BackgroundJob, BackgroundJobCommandResult } from '../../../../src/shared/backgroundJobs';
import { IPC } from '../../../../src/shared/types';

function job(kind: 'scan' | 'thumbnail', state: BackgroundJob['state']): BackgroundJob {
  return {
    jobId: `${kind}-1`, kind, rootPath: '/library', scopePath: '/library', state,
    counts: { discovered: 0, indexed: 0, indexFailed: 0, metadataCompleted: 0, metadataFailed: 0,
      thumbnailsSucceeded: 0, thumbnailsFailed: 0, thumbnailsPending: 0 },
    errors: [], startedAt: null, updatedAt: 0,
  };
}

test('routes generic scan commands to the scan job adapter and preserves its typed result', async () => {
  const expected: BackgroundJobCommandResult = { ok: true, jobId: 'scan-1', state: 'paused' };
  const calls: string[] = [];
  const router = createBackgroundJobCommandRouter({
    getJobs: async () => [job('scan', 'running')],
    scanJobs: {
      pauseJob: async (id) => { calls.push(`pause:${id}`); return expected; },
      resumeJob: async () => ({ ok: false, reason: 'invalid-state' }),
      cancelJob: async () => ({ ok: false, reason: 'invalid-state' }),
      retryJobFailures: async () => ({ ok: false, reason: 'no-retryable-failures' }),
    },
    thumbnailJobs: {
      pauseThumbnailJob: async () => {}, resumeThumbnailJob: async () => {},
      cancelThumbnailJob: async () => {}, retryThumbnailJobFailures: async () => {},
    },
  });

  assert.deepEqual(await router.pause('scan-1'), expected);
  assert.deepEqual(calls, ['pause:scan-1']);
});

test('routes valid thumbnail commands and returns the resulting state', async () => {
  let current = job('thumbnail', 'running');
  const calls: string[] = [];
  const router = createBackgroundJobCommandRouter({
    getJobs: async () => [current],
    scanJobs: {
      pauseJob: async () => ({ ok: false, reason: 'invalid-state' }),
      resumeJob: async () => ({ ok: false, reason: 'invalid-state' }),
      cancelJob: async () => ({ ok: false, reason: 'invalid-state' }),
      retryJobFailures: async () => ({ ok: false, reason: 'no-retryable-failures' }),
    },
    thumbnailJobs: {
      pauseThumbnailJob: async (id) => { calls.push(`pause:${id}`); current = { ...current, state: 'paused' }; },
      resumeThumbnailJob: async (id) => { calls.push(`resume:${id}`); current = { ...current, state: 'running' }; },
      cancelThumbnailJob: async (id) => { calls.push(`cancel:${id}`); current = { ...current, state: 'cancelled' }; },
      retryThumbnailJobFailures: async (id) => { calls.push(`retry:${id}`); current = { ...current, state: 'completed' }; },
    },
  });

  assert.deepEqual(await router.pause('thumbnail-1'), { ok: true, jobId: 'thumbnail-1', state: 'paused' });
  assert.deepEqual(await router.resume('thumbnail-1'), { ok: true, jobId: 'thumbnail-1', state: 'running' });
  assert.deepEqual(await router.cancel('thumbnail-1'), { ok: true, jobId: 'thumbnail-1', state: 'cancelled' });
  current = { ...current, state: 'partial', errors: [{ path: '/library/a.stl', phase: 'thumbnail', code: 'FAILED', message: 'failed', retryable: true }] };
  assert.deepEqual(await router.retryFailures('thumbnail-1'), { ok: true, jobId: 'thumbnail-1', state: 'completed' });
  assert.deepEqual(calls, ['pause:thumbnail-1', 'resume:thumbnail-1', 'cancel:thumbnail-1', 'retry:thumbnail-1']);
});

test('generic thumbnail commands reject unknown, invalid-state, and nonretryable jobs without invoking controls', async () => {
  const current = job('thumbnail', 'failed');
  current.errors = [{ path: '/library/a.stl', phase: 'thumbnail', code: 'NOT_RETRYABLE', message: 'not retained', retryable: false }];
  let calls = 0;
  const router = createBackgroundJobCommandRouter({
    getJobs: async () => [current],
    scanJobs: {
      pauseJob: async () => ({ ok: false, reason: 'invalid-state' }),
      resumeJob: async () => ({ ok: false, reason: 'invalid-state' }),
      cancelJob: async () => ({ ok: false, reason: 'invalid-state' }),
      retryJobFailures: async () => ({ ok: false, reason: 'no-retryable-failures' }),
    },
    thumbnailJobs: {
      pauseThumbnailJob: async () => { calls++; }, resumeThumbnailJob: async () => { calls++; },
      cancelThumbnailJob: async () => { calls++; }, retryThumbnailJobFailures: async () => { calls++; },
    },
  });

  assert.deepEqual(await router.cancel('missing'), { ok: false, reason: 'not-found' });
  assert.deepEqual(await router.pause('thumbnail-1'), { ok: false, reason: 'invalid-state' });
  assert.deepEqual(await router.retryFailures('thumbnail-1'), { ok: false, reason: 'no-retryable-failures' });
  assert.equal(calls, 0);
});

test('registers one generic IPC handler for each background job command', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  registerBackgroundJobCommandHandlers({
    handle: (channel, handler) => { handlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>); },
  } as never, {
    getJobs: async () => [job('scan', 'running')],
    scanJobs: {
      pauseJob: async (jobId) => ({ ok: true, jobId, state: 'paused' }),
      resumeJob: async (jobId) => ({ ok: true, jobId, state: 'running' }),
      cancelJob: async (jobId) => ({ ok: true, jobId, state: 'cancelled' }),
      retryJobFailures: async (jobId) => ({ ok: true, jobId, state: 'completed' }),
    },
    thumbnailJobs: {
      pauseThumbnailJob: async () => {}, resumeThumbnailJob: async () => {},
      cancelThumbnailJob: async () => {}, retryThumbnailJobFailures: async () => {},
    },
  });

  assert.deepEqual([...handlers.keys()], [
    IPC.PAUSE_BACKGROUND_JOB, IPC.RESUME_BACKGROUND_JOB,
    IPC.CANCEL_BACKGROUND_JOB, IPC.RETRY_BACKGROUND_JOB_FAILURES,
  ]);
  assert.deepEqual(await handlers.get(IPC.PAUSE_BACKGROUND_JOB)!({}, 'scan-1'),
    { ok: true, jobId: 'scan-1', state: 'paused' });
});
