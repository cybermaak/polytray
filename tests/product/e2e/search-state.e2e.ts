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
  page_size: 1,
  thumbnailColor: '#2040f0',
  thumbQuality: '128' as const,
};
let app: Awaited<ReturnType<typeof electron.launch>>;
let page: import('@playwright/test').Page;
let scratch: string;
let userData: string;
let library: string;

function copyModel(name: string) {
  fs.copyFileSync(path.join(appRoot, 'tests/support/fixtures/test_model_a.stl'), path.join(library, name));
}

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-search-state-'));
  userData = path.join(scratch, 'userData');
  library = path.join(scratch, 'library');
  fs.mkdirSync(library, { recursive: true });
  copyModel('alpha-model.stl');
  copyModel('beta-model.stl');
  const args = buildElectronLaunchArgs(path.join(appRoot, 'out/main/index.js'), userData, process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []);
  app = await electron.launch({ args, env: buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: userData }) });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#search-input').waitFor();
  await page.evaluate(({ folder, runtimeSettings }) => window.polytray.scanFolder(folder, runtimeSettings), { folder: library, runtimeSettings: settings });
  await expect(page.locator('#library-result-total')).toContainText('2 models');
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
  await expect(page.locator('#library-result-total')).toContainText('2 models');
});

test('rapid type-clear-type applies only the final query and sort/paging/search do not reload warm summaries', async () => {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const api = window.polytray as typeof window.polytray & { __searchCounts?: { stats: number; directories: number; pages: number } };
    const counts = { stats: 0, directories: 0, pages: 0 };
    api.__searchCounts = counts;
    const getStats = api.getStats.bind(api);
    const getDirectories = api.getDirectories.bind(api);
    const getLibraryPage = api.getLibraryPage.bind(api);
    api.getStats = (...args) => { counts.stats += 1; return getStats(...args); };
    api.getDirectories = (...args) => { counts.directories += 1; return getDirectories(...args); };
    api.getLibraryPage = (...args) => { counts.pages += 1; return getLibraryPage(...args); };
  });

  await page.locator('#sort-select').selectOption('size');
  await expect.poll(() => page.evaluate(() => (window.polytray as typeof window.polytray & { __searchCounts?: { stats: number; directories: number; pages: number } }).__searchCounts?.pages ?? 0)).toBeGreaterThan(0);
  await page.locator('#file-grid').evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect.poll(() => page.evaluate(() => (window.polytray as typeof window.polytray & { __searchCounts?: { stats: number; directories: number; pages: number } }).__searchCounts?.pages ?? 0)).toBeGreaterThanOrEqual(2);

  const input = page.locator('#search-input');
  await input.fill('beta');
  await input.fill('');
  await input.fill('alpha');
  await expect(page.locator('#toolbar-context')).toContainText('Search: "alpha"');
  await expect(page.locator('.file-card')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window.polytray as typeof window.polytray & { __searchCounts?: { stats: number; directories: number; pages: number } }).__searchCounts)).toMatchObject({ stats: 0, directories: 0 });
  const counts = await page.evaluate(() => (window.polytray as typeof window.polytray & { __searchCounts?: { stats: number; directories: number; pages: number } }).__searchCounts);
  expect(counts?.pages).toBeGreaterThan(0);
});
