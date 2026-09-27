import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildElectronLaunchArgs, buildElectronLaunchEnv } from '../../support/helpers/electronLaunch';
import { THUMBNAIL_CACHE_VERSION } from '../../../src/main/thumbnailCacheLifecycle';

const appRoot = path.resolve(__dirname, '../../..');
const blueSettings = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 500,
  thumbnailColor: '#2040f0',
  thumbQuality: '128' as const,
};
const redSettings = { ...blueSettings, thumbnailColor: '#f02030' };
let app: Awaited<ReturnType<typeof electron.launch>>;
let page: import('@playwright/test').Page;
let scratch: string;
let userData: string;
let library: string;
let targetFolder: string;
let targetPath: string;
let otherPath: string;

function copyModel(filename: string) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.copyFileSync(path.join(appRoot, 'tests/support/fixtures/test_model_a.stl'), filename);
}

async function launchIsolatedApp() {
  const args = buildElectronLaunchArgs(path.join(appRoot, 'out/main/index.js'), userData, process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []);
  app = await electron.launch({ args, env: buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: userData }) });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#search-input').waitFor();
}

async function getRecords(folderPath: string) {
  return page.evaluate(async (folder) => window.polytray.getFiles({ folder, limit: 100, offset: 0 }), folderPath);
}

async function pixelSignature(thumbnailPath: string) {
  return page.evaluate(async (cachePath) => {
    const dataUrl = await window.polytray.readThumbnail(cachePath);
    if (!dataUrl) return null;
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const sums = [0, 0, 0, 0];
    for (let index = 0; index < rgba.length; index += 4) {
      sums[0] += rgba[index];
      sums[1] += rgba[index + 1];
      sums[2] += rgba[index + 2];
      sums[3] += rgba[index + 3];
    }
    return { width: canvas.width, height: canvas.height, sums };
  }, thumbnailPath);
}

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumbnail-invalidation-'));
  userData = path.join(scratch, 'userData');
  library = path.join(scratch, 'library');
  targetFolder = path.join(library, 'target');
  targetPath = path.join(targetFolder, 'blue-model.stl');
  otherPath = path.join(library, 'other', 'unrelated-model.stl');
  copyModel(targetPath);
  copyModel(otherPath);
  await launchIsolatedApp();
  await page.evaluate(({ folder, settings }) => window.polytray.scanFolder(folder, settings), { folder: library, settings: blueSettings });
});

test.afterAll(async () => {
  if (app) await app.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

test('refresh isolates a folder, clear regenerates current output, and startup removes stale DB pointers', async () => {
  const first = await page.evaluate(async ({ filePath, settings }) => window.polytray.requestThumbnailGeneration(filePath, 'stl', settings), { filePath: targetPath, settings: blueSettings });
  const otherBefore = await page.evaluate(async ({ filePath, settings }) => window.polytray.requestThumbnailGeneration(filePath, 'stl', settings), { filePath: otherPath, settings: blueSettings });
  expect(first).toBeTruthy();
  expect(otherBefore).toBeTruthy();
  expect(fs.existsSync(first!)).toBe(true);
  expect(fs.existsSync(otherBefore!)).toBe(true);
  const bluePixels = await pixelSignature(first!);
  expect(bluePixels).toBeTruthy();

  await page.evaluate(({ folder, settings }) => window.polytray.refreshFolderThumbnails(folder, settings), { folder: targetFolder, settings: redSettings });
  let refreshedPath: string | null = null;
  await expect.poll(async () => {
    const result = await getRecords(targetFolder);
    refreshedPath = result.files.find((file) => file.path === targetPath)?.thumbnail ?? null;
    return refreshedPath;
  }).toBeTruthy();
  expect(refreshedPath).not.toBe(first);
  expect(fs.existsSync(refreshedPath!)).toBe(true);
  const redPixels = await pixelSignature(refreshedPath!);
  expect(redPixels).toBeTruthy();
  expect(redPixels).not.toEqual(bluePixels);
  expect(redPixels!.width).toBe(128);
  expect(redPixels!.height).toBe(128);

  const otherAfter = await getRecords(path.join(library, 'other'));
  expect(otherAfter.files.find((file) => file.path === otherPath)?.thumbnail).toBe(otherBefore);
  expect(fs.existsSync(otherBefore!)).toBe(true);

  await page.evaluate((settings) => window.polytray.clearThumbnails(settings), redSettings);
  expect(fs.existsSync(refreshedPath!)).toBe(false);
  expect(fs.existsSync(otherBefore!)).toBe(false);
  const regenerated = await page.evaluate(async ({ filePath, settings }) => window.polytray.requestThumbnailGeneration(filePath, 'stl', settings), { filePath: targetPath, settings: redSettings });
  expect(regenerated).toBeTruthy();
  expect(fs.existsSync(regenerated!)).toBe(true);
  expect(await pixelSignature(regenerated!)).toEqual(redPixels);

  // Reconcile a missing referenced file without resetting the rest of the cache.
  const regeneratedOther = await page.evaluate(async ({ filePath, settings }) => window.polytray.requestThumbnailGeneration(filePath, 'stl', settings), { filePath: otherPath, settings: redSettings });
  expect(regeneratedOther).toBeTruthy();
  fs.rmSync(regeneratedOther!);
  const cacheDir = path.join(userData, 'thumbnails');
  fs.writeFileSync(path.join(cacheDir, 'cache-meta.json'), JSON.stringify({ version: THUMBNAIL_CACHE_VERSION }));
  await app.close();
  await launchIsolatedApp();
  await expect.poll(async () => (await getRecords(path.join(library, 'other'))).files.find((file) => file.path === otherPath)?.thumbnail ?? null).toBeNull();
  expect(fs.existsSync(regenerated!)).toBe(true);
  const repairedOther = await page.evaluate(async ({ filePath, settings }) => window.polytray.requestThumbnailGeneration(filePath, 'stl', settings), { filePath: otherPath, settings: redSettings });
  expect(repairedOther).toBeTruthy();
  expect(fs.existsSync(repairedOther!)).toBe(true);

  // A version reset removes cache bytes and DB paths before any new request may reuse them.
  const cacheFilesBeforeReset = fs.readdirSync(cacheDir).filter((file) => file.endsWith('.png')).map((file) => path.join(cacheDir, file));
  fs.writeFileSync(path.join(cacheDir, 'cache-meta.json'), JSON.stringify({ version: THUMBNAIL_CACHE_VERSION - 1 }));
  await app.close();
  await launchIsolatedApp();
  await expect.poll(async () => (await getRecords(targetFolder)).files.find((file) => file.path === targetPath)?.thumbnail ?? null).toBeNull();
  for (const cacheFile of cacheFilesBeforeReset) expect(fs.existsSync(cacheFile)).toBe(false);
  const afterReset = await page.evaluate(async ({ filePath, settings }) => window.polytray.requestThumbnailGeneration(filePath, 'stl', settings), { filePath: targetPath, settings: redSettings });
  expect(afterReset).toBeTruthy();
  expect(fs.existsSync(afterReset!)).toBe(true);
});
