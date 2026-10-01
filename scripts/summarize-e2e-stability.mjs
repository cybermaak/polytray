#!/usr/bin/env node
// Summarize repeated Playwright JSON reports into a per-test pass-rate table.
//
// Usage: node scripts/summarize-e2e-stability.mjs <label>=<report.json> [<label>=<report.json> ...]
// Writes Markdown to stdout, and appends it to $GITHUB_STEP_SUMMARY when that is set.
// Missing or unreadable reports are listed in the output instead of aborting the summary.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

function* walkSpecs(suite) {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* walkSpecs(child);
}

function classify(test) {
  if (test.status === 'skipped') return 'skipped';
  if (test.status === 'expected') return 'passed';
  return 'failed';
}

function firstErrorLine(test) {
  for (const result of test.results ?? []) {
    const message = result.error?.message ?? result.errors?.[0]?.message;
    if (message) {
      // Strip ANSI colour codes Playwright embeds in assertion messages.
      const line = message.replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((part) => part.trim()) ?? '';
      return line.trim().slice(0, 140);
    }
  }
  return null;
}

/** @param {Array<{ label: string, report: any }>} reports */
export function summarizeReports(reports) {
  const labels = reports.map(({ label }) => label);
  const byTest = new Map();
  for (const { label, report } of reports) {
    for (const suite of report.suites ?? []) {
      for (const spec of walkSpecs(suite)) {
        const id = `${spec.file}:${spec.line} › ${spec.title}`;
        if (!byTest.has(id)) byTest.set(id, { id, perLabel: {}, errors: new Map() });
        const entry = byTest.get(id);
        const counts = entry.perLabel[label] ??= { passed: 0, failed: 0, skipped: 0 };
        for (const test of spec.tests ?? []) {
          const outcome = classify(test);
          counts[outcome] += 1;
          if (outcome === 'failed') {
            const error = firstErrorLine(test) ?? '(no error message)';
            entry.errors.set(error, (entry.errors.get(error) ?? 0) + 1);
          }
        }
      }
    }
  }
  const tests = [...byTest.values()].map((entry) => {
    let passed = 0;
    let failed = 0;
    for (const counts of Object.values(entry.perLabel)) { passed += counts.passed; failed += counts.failed; }
    const runs = passed + failed;
    const [topError] = [...entry.errors.entries()].sort((a, b) => b[1] - a[1]);
    return { ...entry, passed, failed, passRate: runs === 0 ? null : passed / runs, topError: topError?.[0] ?? null };
  });
  tests.sort((a, b) => (a.passRate ?? 2) - (b.passRate ?? 2) || a.id.localeCompare(b.id));
  return { labels, tests };
}

/** Probability that every executed test passes in one run, assuming independent failures. */
export function estimatedGreenRate(summary) {
  let rate = 1;
  for (const test of summary.tests) {
    for (const counts of Object.values(test.perLabel)) {
      const runs = counts.passed + counts.failed;
      if (runs > 0) rate *= counts.passed / runs;
    }
  }
  return rate;
}

function cell(counts) {
  if (!counts) return '—';
  const runs = counts.passed + counts.failed;
  if (runs === 0) return counts.skipped > 0 ? 'skip' : '—';
  return counts.failed === 0 ? `${counts.passed}/${runs}` : `**${counts.passed}/${runs}**`;
}

export function renderMarkdown(summary, { missing = [], showAll = false } = {}) {
  const lines = ['## E2E stability', ''];
  const unstable = summary.tests.filter((test) => test.failed > 0);
  const green = estimatedGreenRate(summary);
  lines.push(`Tests observed: ${summary.tests.length}. Tests with at least one failure: ${unstable.length}.`);
  lines.push(`Estimated chance a single full matrix run is green: **${(green * 100).toFixed(1)}%** (product of observed per-platform pass rates).`);
  for (const label of missing) lines.push(`> ⚠️ No report for \`${label}\` (job failed before Playwright wrote one).`);
  lines.push('');
  const rows = showAll ? summary.tests : unstable;
  if (rows.length === 0) {
    lines.push('Every executed test passed on every repetition.');
    return `${lines.join('\n')}\n`;
  }
  lines.push(`| Test | ${summary.labels.join(' | ')} | Most common failure |`);
  lines.push(`| --- | ${summary.labels.map(() => '---').join(' | ')} | --- |`);
  for (const test of rows) {
    const error = (test.topError ?? '').replace(/\|/g, '\\|');
    lines.push(`| ${test.id.replace(/\|/g, '\\|')} | ${summary.labels.map((label) => cell(test.perLabel[label])).join(' | ')} | ${error} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const showAll = argv.includes('--all');
  const inputs = argv.filter((arg) => arg !== '--all');
  if (inputs.length === 0) {
    console.error('Usage: node scripts/summarize-e2e-stability.mjs [--all] <label>=<report.json> ...');
    return 1;
  }
  const reports = [];
  const missing = [];
  for (const input of inputs) {
    const separator = input.indexOf('=');
    const label = separator > 0 ? input.slice(0, separator) : input;
    const file = separator > 0 ? input.slice(separator + 1) : input;
    try {
      reports.push({ label, report: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch {
      missing.push(label);
    }
  }
  const markdown = renderMarkdown(summarizeReports(reports), { missing, showAll });
  process.stdout.write(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
