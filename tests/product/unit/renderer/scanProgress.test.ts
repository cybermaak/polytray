import test from 'node:test';
import assert from 'node:assert/strict';
import { getScanProgressPresentation } from '../../../../src/renderer/lib/scanProgress';

test('unknown scan totals use a nonnumeric percent and separate discovered/indexed counts', () => {
  const progress = getScanProgressPresentation({
    current: 0, total: null, filename: '', skipped: false, discovered: 5, indexed: 2,
  });
  assert.deepEqual(progress, {
    percent: 0,
    text: 'Scanning files...',
    count: '5 discovered / 2 indexed',
  });
  assert.equal(Number.isNaN(progress.percent), false);
});

test('known nonzero scan totals retain percentage progress', () => {
  assert.equal(getScanProgressPresentation({ current: 5, total: 10, filename: 'part', skipped: false }).percent, 50);
});
