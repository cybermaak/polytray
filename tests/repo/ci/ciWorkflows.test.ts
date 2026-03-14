import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relPath: string) => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

const buildWorkflow = read('.github/workflows/build.yml');
const releaseWorkflow = read('.github/workflows/release.yml');
const setupAndTestAction = read('.github/actions/setup-and-test/action.yml');
const packageAppAction = read('.github/actions/package-app/action.yml');

function expectMatch(content: string, pattern: RegExp, message?: string) {
  assert.match(content, pattern, message);
}

function expectNoMatch(content: string, pattern: RegExp, message?: string) {
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

test('setup-and-test installs node test dependencies without running electron rebuild', () => {
  expectMatch(setupAndTestAction, /npm ci --ignore-scripts/);
  expectNoMatch(setupAndTestAction, /electron-builder install-app-deps/);
});

test('product test script rebuilds native deps for electron between unit and e2e phases', () => {
  const script = packageJson.scripts?.['test:product'] ?? '';
  expectMatch(script, /npm run test:product:unit/);
  expectMatch(script, /electron-builder install-app-deps/);
  expectMatch(script, /npm run test:product:e2e/);
});

test('package action rebuilds native deps for electron before packaging', () => {
  expectMatch(packageAppAction, /npm run build/);
  expectMatch(packageAppAction, /npx electron-builder install-app-deps/);
  expectMatch(packageAppAction, /npx electron-builder --publish never/);
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
