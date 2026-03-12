const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readmePath = path.join(repoRoot, 'README.md');

function fileSize(relPath) {
  return fs.statSync(path.join(repoRoot, relPath)).size;
}

test('README includes v1.1 landing-page sections and stable media references', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.match(readme, /^# Polytray/m);
  assert.match(readme, /^## Visual Tour$/m);
  assert.match(readme, /^## Why Polytray$/m);
  assert.match(readme, /^## What's New in v1\.1\.0$/m);
  assert.match(readme, /^## Core Workflow$/m);
  assert.match(readme, /^## Development$/m);
  assert.match(readme, /^## Status$/m);
  assert.match(readme, /docs\/assets\/polytray_demo\.webp/);
  assert.match(readme, /docs\/assets\/screenshot\.png/);
});

test('README media assets exist and are non-empty', () => {
  assert.ok(fileSize('docs/assets/polytray_demo.webp') > 0);
  assert.ok(fileSize('docs/assets/screenshot.png') > 0);
});
