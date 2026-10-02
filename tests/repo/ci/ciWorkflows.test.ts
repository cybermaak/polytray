import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relPath: string) => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

const buildWorkflow = read('.github/workflows/build.yml');
const stabilityWorkflow = read('.github/workflows/e2e-stability.yml');
const releaseWorkflow = read('.github/workflows/release.yml');
const setupAndTestAction = read('.github/actions/setup-and-test/action.yml');
const packageAppAction = read('.github/actions/package-app/action.yml');
const playwrightConfig = read('playwright.config.ts');

function expectMatch(content: string, pattern: RegExp, message?: string) {
  assert.match(content, pattern, message);
}

function expectNoMatch(content: string, pattern: RegExp, message?: string) {
  assert.doesNotMatch(content, pattern, message);
}

test('build workflow runs on main pushes, pull requests, and dispatch without daily builds', () => {
  expectMatch(buildWorkflow, /^name: Build$/m);
  expectMatch(buildWorkflow, /^on:\n  push:\n    branches:\n      - main\n  pull_request:\n  workflow_dispatch:/m);
  expectNoMatch(buildWorkflow, /^\s*schedule:/m);
  expectNoMatch(buildWorkflow, /^\s*check-commits:/m);
});

test('build cancels only superseded pull request runs', () => {
  expectMatch(buildWorkflow, /^concurrency:\n  group: build-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}\n  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/m);
});

test('build and release jobs have bounded timeouts', () => {
  expectMatch(buildWorkflow, /^  build:\n    # [^\n]*\n    timeout-minutes: \d+/m);
  expectMatch(releaseWorkflow, /^  release:\n    timeout-minutes: \d+/m);
});

test('build matrix retains independent platform results and failed E2E context', () => {
  expectMatch(buildWorkflow, /strategy:\n\s+fail-fast: false\n\s+matrix:/);
  expectMatch(buildWorkflow, /name: Upload Test Failure Evidence\n\s+if: failure\(\)\n\s+uses: actions\/upload-artifact@v7/);
  expectMatch(buildWorkflow, /name: polytray-\$\{\{ runner\.os \}\}-test-failures/);
  expectMatch(buildWorkflow, /test-results\//);
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

test('workflow actions use Node 24-native major versions', () => {
  expectMatch(buildWorkflow, /uses: actions\/checkout@v6/);
  expectMatch(releaseWorkflow, /uses: actions\/checkout@v6/);
  expectMatch(buildWorkflow, /uses: actions\/upload-artifact@v7/);
  expectMatch(releaseWorkflow, /uses: actions\/upload-artifact@v7/);
  expectMatch(setupAndTestAction, /uses: actions\/setup-node@v6/);
  expectNoMatch(buildWorkflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24/);
  expectNoMatch(releaseWorkflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24/);
});

test('setup-and-test pins Node from .nvmrc and caches npm', () => {
  expectMatch(setupAndTestAction, /node-version-file: \.nvmrc/);
  expectMatch(setupAndTestAction, /cache: npm/);
  expectNoMatch(setupAndTestAction, /node-version: /);
  assert.match(read('.nvmrc').trim(), /^\d+$/);
});

test('setup-and-test installs only Linux system libraries, not Playwright browsers', () => {
  expectNoMatch(setupAndTestAction, /playwright install(?!-deps)/);
  expectMatch(setupAndTestAction, /if: runner\.os == 'Linux'\n\s+shell: bash\n\s+run: \|\n\s+sudo apt-get update\n\s+npx playwright install-deps chromium/);
});

test('setup-and-test runs a caller-provided command that defaults to the Product gate', () => {
  expectMatch(setupAndTestAction, /test-command:\n(?:\s+[^\n]*\n)*?\s+default: "npm run test:product"/);
  expectMatch(setupAndTestAction, /POLYTRAY_TEST_COMMAND: \$\{\{ inputs\.test-command \}\}/);
  // The command is passed through the environment so it is never re-interpolated into the script.
  expectNoMatch(setupAndTestAction, /run: [^\n]*\$\{\{ inputs\./);
  assert.equal((setupAndTestAction.match(/eval "\$POLYTRAY_TEST_COMMAND"/g) ?? []).length, 2);
});

test('setup-and-test installs dependencies normally but skips only the repo postinstall rebuild', () => {
  expectMatch(setupAndTestAction, /POLYTRAY_SKIP_INSTALL_APP_DEPS:\s*["']?1["']?/);
  expectMatch(setupAndTestAction, /run: npm ci/);
  expectNoMatch(setupAndTestAction, /ignore-scripts/);
});

test('Linux Product runs with a ready window manager inside its Xvfb display', () => {
  expectMatch(setupAndTestAction, /apt-get install[^\n]*openbox[^\n]*x11-utils/);
  expectMatch(setupAndTestAction, /xvfb-run[^\n]*bash -c/);
  expectMatch(setupAndTestAction, /openbox --sm-disable/);
  expectMatch(setupAndTestAction, /xprop -root _NET_SUPPORTING_WM_CHECK/);
  expectMatch(setupAndTestAction, /cleanup\(\)[^\n]*wm_pid/);
  expectMatch(setupAndTestAction, /trap cleanup EXIT/);
  expectMatch(setupAndTestAction, /apt-get install[^\n]*xvfb/);
  expectMatch(setupAndTestAction, /npm run test:product/);
});

test('hosted Build E2E failures retain traces and screenshots without retries', () => {
  expectMatch(playwrightConfig, /retries:\s*0/);
  expectMatch(playwrightConfig, /process\.env\.GITHUB_WORKFLOW === 'Build'/);
  expectMatch(playwrightConfig, /process\.env\.GITHUB_WORKFLOW === 'E2E Stability'/);
  expectMatch(playwrightConfig, /trace:\s*captureBuildFailures\s*\?\s*'retain-on-failure'/);
  expectMatch(playwrightConfig, /screenshot:\s*captureBuildFailures\s*\?\s*'only-on-failure'/);
});

test('package postinstall honors the skip flag and otherwise rebuilds native deps', () => {
  const script = packageJson.scripts?.postinstall ?? '';
  expectMatch(script, /build\/scripts\/postinstall/);
});

test('product test script rebuilds native deps for electron between unit and e2e phases', () => {
  const script = packageJson.scripts?.['test:product'] ?? '';
  expectMatch(script, /npm run test:product:unit/);
  expectMatch(script, /electron-builder install-app-deps/);
  expectMatch(script, /npm run test:product:e2e/);
});

test('product test script clears the stale Electron rebuild marker after the Node rebuild', () => {
  const script = packageJson.scripts?.['test:product'] ?? '';
  const nodeRebuild = script.indexOf('npm rebuild better-sqlite3');
  const clearMarker = script.indexOf('node build/scripts/clear-electron-rebuild-marker.js');
  const electronRebuild = script.indexOf('electron-builder install-app-deps');
  assert.ok(nodeRebuild >= 0 && nodeRebuild < clearMarker && clearMarker < electronRebuild, script);
  expectMatch(read('build/scripts/clear-electron-rebuild-marker.js'), /better-sqlite3\/build\/Release\/\.forge-meta/);
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

test('E2E builds the app once in global setup instead of inside individual spec files', () => {
  expectMatch(playwrightConfig, /globalSetup: '\.\/tests\/support\/playwright\/globalSetup\.ts'/);
  const e2eDir = path.join(repoRoot, 'tests/product/e2e');
  for (const file of fs.readdirSync(e2eDir).filter((name) => name.endsWith('.e2e.ts'))) {
    expectNoMatch(fs.readFileSync(path.join(e2eDir, file), 'utf8'), /npm run build/, `${file} must rely on the global build`);
  }
});

test('E2E stability workflow is manual, non-gating, and measures repeated runs per platform', () => {
  expectMatch(stabilityWorkflow, /^name: E2E Stability$/m);
  expectMatch(stabilityWorkflow, /^on:\n  workflow_dispatch:\n/m);
  expectNoMatch(stabilityWorkflow, /^\s+(push|pull_request):/m);
  expectMatch(stabilityWorkflow, /fail-fast: false/);
  expectMatch(stabilityWorkflow, /uses: \.\/\.github\/actions\/setup-and-test/);
  expectMatch(stabilityWorkflow, /--repeat-each="\$STABILITY_REPEAT"/);
  expectMatch(stabilityWorkflow, /--reporter=list,json/);
  expectMatch(stabilityWorkflow, /PLAYWRIGHT_JSON_OUTPUT_FILE: e2e-stability\.json/);
  expectMatch(stabilityWorkflow, /node scripts\/summarize-e2e-stability\.mjs/);
  // Free-text inputs reach the shell only through env vars, never via expression interpolation.
  expectNoMatch(stabilityWorkflow, /run:[^\n]*\$\{\{ inputs\./);
  expectNoMatch(stabilityWorkflow, /test-command:[\s\S]*?\$\{\{ inputs\.[\s\S]*?- name: Summarize this platform/);
  expectMatch(stabilityWorkflow, /\^\(\[1-9\]\|1\[0-9\]\|20\)\$/);
});

test('E2E stability summary lists every requested platform, including ones with no report', () => {
  expectMatch(stabilityWorkflow, /STABILITY_PLATFORMS: \$\{\{ inputs\.platforms \}\}/);
  expectMatch(stabilityWorkflow, /all\) labels=\(Linux macOS Windows\)/);
  // Placeholders are passed unconditionally; the script reports absent files as missing.
  expectNoMatch(stabilityWorkflow, /if \[ -d "reports\/e2e-stability-/);
  expectMatch(stabilityWorkflow, /name: Download stability reports\n\s+#[^\n]*\n\s+continue-on-error: true/);
});
