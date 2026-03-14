import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const readmePath = path.join(repoRoot, 'README.md');

function fileSize(relPath: string) {
  return fs.statSync(path.join(repoRoot, relPath)).size;
}

test('README includes v1.1 landing-page sections and stable media references', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.match(readme, /^# Polytray/m);
  assert.match(readme, /^## Features$/m);
  assert.match(readme, /^## Getting Started$/m);
  assert.match(readme, /^## How It Works$/m);
  assert.match(readme, /^## Development$/m);
  assert.match(readme, /^## Status$/m);
  assert.match(readme, /docs\/assets\/polytray_demo\.webp/);
  assert.match(readme, /docs\/assets\/screenshot\.png/);
});

test('README media assets exist and are non-empty', () => {
  assert.ok(fileSize('docs/assets/polytray_demo.webp') > 0);
  assert.ok(fileSize('docs/assets/screenshot.png') > 0);
});
