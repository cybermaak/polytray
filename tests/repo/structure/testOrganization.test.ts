import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const agentsGuide = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');

function exists(relPath: string) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

test('package scripts separate product tests from repo verification', () => {
  assert.ok(packageJson.scripts['test:product']);
  assert.ok(packageJson.scripts['test:product:unit']);
  assert.ok(packageJson.scripts['test:product:e2e']);
  assert.ok(packageJson.scripts['test:repo']);
  assert.equal(packageJson.scripts['test:e2e'], 'npm run test:product:e2e');
});

test('test tree uses product, repo, support, and dev boundaries', () => {
  assert.equal(exists('tests/product/e2e/app.e2e.ts'), true);
  assert.equal(exists('tests/product/unit/shared/settingsStore.test.ts'), true);
  assert.equal(exists('tests/repo/ci/ciWorkflows.test.ts'), true);
  assert.equal(exists('tests/repo/docs/readmeAssets.test.ts'), true);
  assert.equal(exists('tests/support/helpers/electronLaunch.ts'), true);
  assert.equal(exists('tests/support/fixtures/generateFixtures.ts'), true);
  assert.equal(exists('tests/dev/verify-ui.ts'), true);
});

test('maintenance scripts and temp-work conventions stay intentional', () => {
  assert.equal(exists('scripts/capture-readme-media.ts'), true);
  assert.equal(exists('scripts/capture-readme-media.mjs'), false);
  assert.equal(exists('rewrite_sidebar.js'), false);
  assert.equal(exists('.agent-tmp'), false);
  assert.match(agentsGuide, /\.agent-tmp\//);
  assert.match(gitignore, /^\.agent-tmp\/$/m);
});

test('legacy ad-hoc and accidental filesystem artifacts are absent', () => {
  for (const relPath of [
    'tests/app.e2e.js',
    'tests/readmeAssets.test.js',
    'tests/ciWorkflows.test.js',
    'tests/test2.js',
    'tests/verify-ui.js',
    'tests/preview-screenshot.png',
    'tests/generate-fixtures.js',
    'tests/generate-many.js',
    '.DS_Store',
    'build/.DS_Store',
    'docs/.DS_Store',
  ]) {
    assert.equal(exists(relPath), false, relPath);
  }
});
