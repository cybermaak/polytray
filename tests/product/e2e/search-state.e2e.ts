import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildElectronLaunchArgs, buildElectronLaunchEnv } from '../../support/helpers/electronLaunch';

const appRoot = path.resolve(__dirname, '../../..');
const settings = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 50,
  thumbnailColor: '#2040f0',
  thumbQuality: '128' as const,
};
let app: Awaited<ReturnType<typeof electron.launch>>;
let page: import('@playwright/test').Page;
let scratch: string;
let userData: string;
let library: string;

interface IsolatedRequestCounts {
  libraryPages: number;
  stats: number;
  directories: number;
}

async function resetRequestCounts() {
  await app.evaluate(() => {
    const counts = (globalThis as typeof globalThis & {
      __POLYTRAY_ISOLATED_REQUEST_COUNTS?: IsolatedRequestCounts;
    }).__POLYTRAY_ISOLATED_REQUEST_COUNTS;
    if (!counts) throw new Error('Isolated request counters are not installed');
    counts.libraryPages = 0;
    counts.stats = 0;
    counts.directories = 0;
  });
}

async function readRequestCounts(): Promise<IsolatedRequestCounts> {
  return app.evaluate(() => {
    const counts = (globalThis as typeof globalThis & {
      __POLYTRAY_ISOLATED_REQUEST_COUNTS?: IsolatedRequestCounts;
    }).__POLYTRAY_ISOLATED_REQUEST_COUNTS;
    if (!counts) throw new Error('Isolated request counters are not installed');
    return { ...counts };
  });
}

function copyModel(name: string) {
  fs.copyFileSync(path.join(appRoot, 'tests/support/fixtures/test_model_a.stl'), path.join(library, name));
}

async function findMainWindow() {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (const candidate of app.windows()) {
      try {
        await candidate.locator('#search-input').waitFor({ state: 'visible', timeout: 200 });
        return candidate;
      } catch { /* Ignore hidden preview and thumbnail renderers. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Visible main window did not become ready');
}

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-search-state-'));
  userData = path.join(scratch, 'userData');
  library = path.join(scratch, 'library');
  fs.mkdirSync(library, { recursive: true });
  copyModel('alpha-model.stl');
  copyModel('beta-model.stl');
  for (let index = 0; index < 60; index += 1) {
    copyModel(`page-model-${String(index).padStart(2, '0')}.stl`);
  }
  const args = buildElectronLaunchArgs(path.join(appRoot, 'out/main/index.js'), userData, process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []);
  app = await electron.launch({ args, env: buildElectronLaunchEnv(process.env, {
    ELECTRON_USER_DATA: userData,
    POLYTRAY_ISOLATED_TEST: '1',
  }) });
  page = await findMainWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#empty-state')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('polytray-settings') || '{}');
    localStorage.setItem('polytray-settings', JSON.stringify({ ...current, page_size: 50, autoScan: false, watch: false }));
  });
  await page.reload();
  await page.locator('#search-input').waitFor();
  await expect(page.locator('#empty-state')).toBeVisible({ timeout: 15000 });
  await page.evaluate(({ folder, runtimeSettings }) => window.polytray.scanFolder(folder, runtimeSettings), { folder: library, runtimeSettings: settings });
  await expect(page.locator('#library-result-total')).toHaveText('62 models');
});

test.afterAll(async () => {
  if (app) await app.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

test('clearing the search chip cancels the draft debounce and leaves the applied query empty', async () => {
  const input = page.locator('#search-input');
  await input.fill('alpha');
  await expect(page.locator('#toolbar-context')).toContainText('Search: "alpha"');
  await expect(page.locator('.file-card')).toHaveCount(1);

  await page.locator('.context-chip-dismiss[title="Remove search filter"]').click();
  await expect(input).toHaveValue('');
  await expect(page.locator('#toolbar-context')).not.toContainText('Search:');
  await page.waitForTimeout(300);

  await expect(input).toHaveValue('');
  await expect(page.locator('#toolbar-context')).not.toContainText('Search:');
  await expect(page.locator('#library-result-total')).toContainText('62 models');
});

test('rapid type-clear-type applies only the final query after sorting and paging', async () => {
  await page.waitForTimeout(300);
  await resetRequestCounts();
  await page.locator('#sort-select').selectOption('size');
  await expect(page.locator('#library-result-total')).toContainText('62 models');
  await expect.poll(async () => (await readRequestCounts()).libraryPages).toBeGreaterThan(0);
  for (let attempt = 0; attempt < 4 && (await readRequestCounts()).libraryPages < 2; attempt += 1) {
    await page.locator('[data-virtuoso-scroller]').evaluate((element) => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(100);
  }
  await expect.poll(async () => (await readRequestCounts()).libraryPages).toBeGreaterThanOrEqual(2);

  const input = page.locator('#search-input');
  await input.fill('beta');
  await input.fill('');
  await input.fill('alpha');
  await expect(page.locator('#toolbar-context')).toContainText('Search: "alpha"');
  await expect(page.locator('.file-card')).toHaveCount(1);
  const counts = await readRequestCounts();
  expect(counts.stats).toBe(0);
  expect(counts.directories).toBe(0);
  expect(counts.libraryPages).toBeGreaterThanOrEqual(3);
});
