import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';
import { createThumbnailIdentity, thumbnailCacheFilename } from '../../../src/main/thumbnailIdentity';

const settings = {
  thumbnail_timeout: 20_000, scanning_batch_size: 10, watcher_stability: 500,
  page_size: 50, thumbnailColor: '#2040f0', thumbQuality: '128' as const,
};
const clearSettings = { ...settings, thumbnailColor: '#f02030' };
const activeSettings = { ...settings, thumbnailColor: '#10d030' };

async function findMainWindow(app: Awaited<ReturnType<typeof launchIsolatedApp>>['app']) {
  await app.firstWindow();
  await expect.poll(async () => {
    for (const page of app.windows()) if (await page.locator('#search-input').isVisible().catch(() => false)) return true;
    return false;
  }, { timeout: 15_000 }).toBe(true);
  for (const page of app.windows()) if (await page.locator('#search-input').isVisible().catch(() => false)) return page;
  throw new Error('Visible main window did not become ready');
}

test('clearing thumbnails fences an active generation before it can publish stale output', async () => {
  test.setTimeout(90_000);
  const env: NodeJS.ProcessEnv = {};
  let modelPath = '';
  let holdPath = '';
  let reachedPath = '';
  let releasePath = '';
  let finishedPath = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(process.cwd(), 'out/main/index.js'),
    env,
    beforeLaunch: ({ scratchDir }) => {
      const library = path.join(scratchDir, 'library');
      fs.mkdirSync(library, { recursive: true });
      modelPath = path.join(library, 'active.stl');
      fs.copyFileSync(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), modelPath);
      holdPath = path.join(scratchDir, 'thumbnail-generation-hold');
      reachedPath = path.join(scratchDir, 'thumbnail-generation-reached');
      releasePath = path.join(scratchDir, 'thumbnail-generation-release');
      finishedPath = path.join(scratchDir, 'thumbnail-generation-finished');
      env.POLYTRAY_THUMBNAIL_TEST_TARGET_PATH = modelPath;
    },
  });
  try {
    const page = await findMainWindow(isolated.app);
    const library = path.dirname(modelPath);
    await page.evaluate(root => {
      const current = JSON.parse(localStorage.getItem('polytray-settings') || '{}');
      localStorage.setItem('polytray-settings', JSON.stringify({ ...current, autoScan: false, watch: false }));
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [root], lastFolder: root }));
    }, library);
    await page.reload();
    await page.locator('#search-input').waitFor();
    const scan = await page.evaluate(({ root, options }) => window.polytray.scanFolder(root, options), { root: library, options: settings });
    expect(scan.state).toBe('completed');

    let initialBluePath: string | null = null;
    await expect.poll(async () => {
      const result = await page.evaluate(folder => window.polytray.getFiles({ folder, limit: 10, offset: 0 }), library);
      initialBluePath = result.files.find(file => file.path === modelPath)?.thumbnail ?? null;
      return initialBluePath;
    }, { timeout: 30_000 }).toBeTruthy();
    expect(fs.existsSync(initialBluePath!)).toBe(true);

    await page.evaluate(options => window.polytray.clearThumbnails(options), clearSettings);
    let redPath: string | null = null;
    await expect.poll(async () => {
      const result = await page.evaluate(folder => window.polytray.getFiles({ folder, limit: 10, offset: 0 }), library);
      redPath = result.files.find(file => file.path === modelPath)?.thumbnail ?? null;
      return redPath && redPath !== initialBluePath ? redPath : null;
    }, { timeout: 30_000 }).toBeTruthy();
    expect(fs.existsSync(redPath!)).toBe(true);
    const indexed = await page.evaluate(folder => window.polytray.getFiles({ folder, limit: 10, offset: 0 }), library);
    const fileRecord = indexed.files.find(file => file.path === modelPath);
    expect(fileRecord).toBeTruthy();
    const staleColorPath = path.join(isolated.userDataDir, 'thumbnails', thumbnailCacheFilename(
      createThumbnailIdentity(modelPath, fileRecord!.content_revision, activeSettings.thumbnailColor, 128).key,
    ));

    fs.writeFileSync(holdPath, 'hold the next generation for this exact model');
    await page.evaluate(({ filePath, options }) => {
      const state = window as Window & { __thumbnailRace?: { settled: boolean; result: string | null; error: string | null } };
      state.__thumbnailRace = { settled: false, result: null, error: null };
      void window.polytray.requestThumbnailGeneration(filePath, 'stl', options).then(result => {
        if (state.__thumbnailRace) state.__thumbnailRace = { settled: true, result, error: null };
      }, error => {
        if (state.__thumbnailRace) state.__thumbnailRace = { settled: true, result: null, error: String(error) };
      });
    }, { filePath: modelPath, options: activeSettings });
    try {
      await expect.poll(() => fs.existsSync(reachedPath), { timeout: 20_000 }).toBe(true);
    } catch (error) {
      const diagnostic = await page.evaluate(async () => ({
        race: (window as Window & { __thumbnailRace?: { settled: boolean; result: string | null } }).__thumbnailRace,
        jobs: await window.polytray.getBackgroundJobs(),
      }));
      throw new Error(`Thumbnail gate did not engage; hold=${fs.existsSync(holdPath)} race=${JSON.stringify(diagnostic)}`, { cause: error });
    }
    expect(fs.readFileSync(reachedPath, 'utf8')).toContain('thumbnail generation reached isolated test gate');
    expect(await page.evaluate(() => (window as Window & { __thumbnailRace?: { settled: boolean } }).__thumbnailRace?.settled)).toBe(false);

    await page.evaluate(options => window.polytray.clearThumbnails(options), clearSettings);
    expect(await page.evaluate(({ targetPath, folder }) => window.polytray.getFiles({ folder, limit: 10, offset: 0 })
      .then(result => result.files.find(file => file.path === targetPath)?.thumbnail ?? null), { targetPath: modelPath, folder: library })).toBeNull();
    await expect.poll(() => page.evaluate(() => (window as Window & { __thumbnailRace?: { settled: boolean } }).__thumbnailRace?.settled), { timeout: 20_000 }).toBe(true);
    const oldRequest = await page.evaluate(() => (window as Window & { __thumbnailRace?: { result: string | null; error: string | null } }).__thumbnailRace);
    expect(oldRequest?.result).toBeNull();
    expect(oldRequest?.error).toContain('Thumbnail job cancelled');
    fs.writeFileSync(releasePath, 'release');
    await expect.poll(() => fs.existsSync(finishedPath), { timeout: 20_000 }).toBe(true);
    expect(fs.readFileSync(finishedPath, 'utf8')).toBe('stale response rejected by cache identity guard');
    expect(fs.existsSync(staleColorPath)).toBe(false);
    const afterStaleResponse = await page.evaluate(({ targetPath, folder }) => window.polytray.getFiles({ folder, limit: 10, offset: 0 })
      .then(rows => rows.files.find(file => file.path === targetPath)?.thumbnail ?? null), { targetPath: modelPath, folder: library });
    expect(afterStaleResponse).not.toBe(staleColorPath);

    await expect.poll(async () => {
      const result = await page.evaluate(({ targetPath, folder }) => window.polytray.getFiles({ folder, limit: 10, offset: 0 })
        .then(rows => rows.files.find(file => file.path === targetPath)?.thumbnail ?? null), { targetPath: modelPath, folder: library });
      return result;
    }, { timeout: 30_000 }).toBeTruthy();
    const latest = await page.evaluate(({ targetPath, folder }) => window.polytray.getFiles({ folder, limit: 10, offset: 0 })
      .then(rows => rows.files.find(file => file.path === targetPath)?.thumbnail ?? null), { targetPath: modelPath, folder: library });
    expect(latest).toBeTruthy();
    expect(latest).not.toBe(initialBluePath);
    expect(latest).not.toBe(staleColorPath);
    expect(fs.existsSync(latest!)).toBe(true);
    expect(fs.existsSync(initialBluePath!)).toBe(false);
    expect(fs.existsSync(staleColorPath)).toBe(false);

    const regeneratedBlue = await page.evaluate(({ filePath, options }) => window.polytray.requestThumbnailGeneration(filePath, 'stl', options),
      { filePath: modelPath, options: activeSettings });
    expect(regeneratedBlue).toBeTruthy();
    expect(fs.existsSync(regeneratedBlue!)).toBe(true);
    expect(await page.evaluate(({ targetPath, folder }) => window.polytray.getFiles({ folder, limit: 10, offset: 0 })
      .then(rows => rows.files.find(file => file.path === targetPath)?.thumbnail ?? null), { targetPath: modelPath, folder: library })).toBe(regeneratedBlue);
  } finally {
    if (releasePath) fs.writeFileSync(releasePath, 'release');
    await isolated.close();
  }
});
