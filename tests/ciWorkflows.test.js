const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (relPath) => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

const buildWorkflow = read('.github/workflows/build.yml');
const releaseWorkflow = read('.github/workflows/release.yml');

function expectMatch(content, pattern, message) {
  assert.match(content, pattern, message);
}

function expectNoMatch(content, pattern, message) {
  assert.doesNotMatch(content, pattern, message);
}

test('build workflow runs on push and no longer schedules daily builds', () => {
  expectMatch(buildWorkflow, /^name: Build$/m);
  expectMatch(buildWorkflow, /^on:\n  push:\n    branches:\n      - main\n  workflow_dispatch:/m);
  expectNoMatch(buildWorkflow, /^\s*schedule:/m);
  expectNoMatch(buildWorkflow, /^\s*check-commits:/m);
});

test('build and release workflows share setup and packaging actions', () => {
  expectMatch(buildWorkflow, /uses: \.\/\.github\/actions\/setup-and-test/);
  expectMatch(buildWorkflow, /uses: \.\/\.github\/actions\/package-app/);
  expectMatch(releaseWorkflow, /uses: \.\/\.github\/actions\/setup-and-test/);
  expectMatch(releaseWorkflow, /uses: \.\/\.github\/actions\/package-app/);
  expectNoMatch(buildWorkflow, /npm run build/);
  expectNoMatch(buildWorkflow, /electron-builder --publish never/);
  expectNoMatch(releaseWorkflow, /npm run build/);
  expectNoMatch(releaseWorkflow, /electron-builder --publish never/);
});

test('workflow artifact patterns preserve updater files and exclude snap artifacts', () => {
  for (const workflow of [buildWorkflow, releaseWorkflow]) {
    expectMatch(workflow, /dist\/\*\.exe/);
    expectMatch(workflow, /dist\/\*\.dmg/);
    expectMatch(workflow, /dist\/\*-mac\.zip/);
    expectMatch(workflow, /dist\/\*\.AppImage/);
    expectMatch(workflow, /dist\/\*\.blockmap/);
    expectMatch(workflow, /latest\*\.yml/);
    expectNoMatch(workflow, /dist\/\*\.snap/);
  }
});
