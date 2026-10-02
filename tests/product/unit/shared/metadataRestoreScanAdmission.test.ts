import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveScanWork } from '../../../../src/shared/metadataRestoreScanAdmission';
import type { BackgroundJob } from '../../../../src/shared/backgroundJobs';
function job(state: BackgroundJob['state'], kind: BackgroundJob['kind'] = 'scan'): BackgroundJob {
  return { jobId: 'scan-1', kind, state } as BackgroundJob;
}
test('all active scan phases across any root disable import, terminal scans and thumbnails do not', () => {
  for (const state of ['queued', 'running', 'pausing', 'paused', 'cancelling'] as const) {
    assert.equal(hasActiveScanWork([job(state)]), true, state);
    assert.equal(hasActiveScanWork([job(state, 'thumbnail')]), false, state);
  }
  for (const state of ['completed', 'cancelled', 'partial', 'failed'] as const) assert.equal(hasActiveScanWork([job(state)]), false, state);
  assert.equal(hasActiveScanWork([job('partial')], new Set(['scan-1'])), true, 'pending retry');
  assert.equal(hasActiveScanWork([job('partial', 'thumbnail')], new Set(['scan-1'])), false);
});
