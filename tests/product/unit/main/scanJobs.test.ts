import test from 'node:test';
import assert from 'node:assert/strict';
import { ScanJobsController } from '../../../../src/main/scanJobs';

test('invalid commands return typed results without invoking the scan adapter', async () => {
  let resumes = 0;
  let state = 'running';
  const jobs = new ScanJobsController({
    getJobs: () => state === 'missing' ? [] : [{
      jobId: 'scan-test', kind: 'scan', rootPath: '/library', scopePath: '/library', state: state as never,
      counts: { discovered: 0, indexed: 0, indexFailed: 0, metadataCompleted: 0, metadataFailed: 0,
        thumbnailsSucceeded: 0, thumbnailsFailed: 0, thumbnailsPending: 0 }, errors: [], startedAt: null, updatedAt: 0,
    }], onChanged: () => () => {},
    pause: async () => false,
    resume: async () => { resumes++; return false; },
    cancel: async () => false,
    retryFailures: async () => false,
  });

  assert.deepEqual(await jobs.resumeJob('missing-id'), { ok: false, reason: 'not-found' });
  assert.deepEqual(await jobs.resumeJob('scan-test'), { ok: true, jobId: 'scan-test', state: 'running' });
  assert.deepEqual(await jobs.retryJobFailures('scan-test'), { ok: false, reason: 'invalid-state' });
  state = 'failed';
  assert.deepEqual(await jobs.retryJobFailures('scan-test'), { ok: false, reason: 'no-retryable-failures' });
  state = 'paused';
  assert.deepEqual(await jobs.pauseJob('scan-test'), { ok: true, jobId: 'scan-test', state: 'paused' });
  state = 'cancelled';
  assert.deepEqual(await jobs.cancelJob('scan-test'), { ok: true, jobId: 'scan-test', state: 'cancelled' });
  assert.equal(resumes, 0);
});
