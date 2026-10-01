import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- plain ESM script without type declarations
import { summarizeReports, renderMarkdown, estimatedGreenRate } from '../../../scripts/summarize-e2e-stability.mjs';

function spec(title: string, line: number, statuses: string[], error = 'Error: boom') {
  return {
    title, file: 'example.e2e.ts', line,
    tests: statuses.map((status) => ({
      status,
      results: [{ status: status === 'expected' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed',
        ...(status === 'unexpected' ? { error: { message: `\u001b[31m${error}\u001b[39m\nstack` } } : {}) }],
    })),
  };
}

const linux = { suites: [{ title: 'example.e2e.ts', specs: [
  spec('stable', 1, ['expected', 'expected']),
  spec('flaky', 2, ['expected', 'unexpected']),
], suites: [{ title: 'nested', specs: [spec('skipped', 3, ['skipped', 'skipped'])] }] }] };
const windows = { suites: [{ title: 'example.e2e.ts', specs: [
  spec('stable', 1, ['expected', 'expected']),
  spec('flaky', 2, ['unexpected', 'unexpected'], 'Error: timeout'),
] }] };

test('summary counts each repetition per platform and sorts the least stable first', () => {
  const summary = summarizeReports([{ label: 'Linux', report: linux }, { label: 'Windows', report: windows }]);
  assert.deepEqual(summary.labels, ['Linux', 'Windows']);
  const [first] = summary.tests;
  assert.equal(first.id, 'example.e2e.ts:2 › flaky');
  assert.deepEqual(first.perLabel.Linux, { passed: 1, failed: 1, skipped: 0 });
  assert.deepEqual(first.perLabel.Windows, { passed: 0, failed: 2, skipped: 0 });
  assert.equal(first.topError, 'Error: timeout');
  const skipped = summary.tests.find((entry: { id: string }) => entry.id.endsWith('skipped'));
  assert.equal(skipped.passRate, null);
});

test('estimated green rate multiplies per-platform pass rates', () => {
  const summary = summarizeReports([{ label: 'Linux', report: linux }]);
  assert.equal(estimatedGreenRate(summary), 0.5);
});

test('markdown lists only unstable tests by default and reports missing platforms', () => {
  const summary = summarizeReports([{ label: 'Linux', report: linux }]);
  const markdown = renderMarkdown(summary, { missing: ['macOS'] });
  assert.match(markdown, /\| example\.e2e\.ts:2 › flaky \| \*\*1\/2\*\* \| Error: boom \|/);
  assert.doesNotMatch(markdown, /› stable/);
  assert.match(markdown, /No report for `macOS`/);
  assert.match(renderMarkdown(summary, { showAll: true }), /› stable \| 2\/2/);
});
