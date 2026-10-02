import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { findMainWindow, launchIsolatedApp } from '../../support/helpers/isolatedApp';

const settings = {
  thumbnail_timeout: 20_000, scanning_batch_size: 10, watcher_stability: 500,
  page_size: 50, thumbnailColor: '#2040f0', thumbQuality: '128' as const,
};

test('a completed thumbnail becomes visible while a later batch item is held', async () => {
  test.setTimeout(90_000);
  const env: NodeJS.ProcessEnv = {};
  let readyPath = '';
  let heldPath = '';
  let reachedPath = '';
  let releasePath = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(process.cwd(), 'out/main/index.js'),
    env,
    beforeLaunch: ({ scratchDir }) => {
      const library = path.join(scratchDir, 'library');
      fs.mkdirSync(library);
      readyPath = path.join(library, 'a-ready.stl');
      heldPath = path.join(library, 'z-held.stl');
      const fixture = path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl');
      fs.copyFileSync(fixture, readyPath);
      fs.copyFileSync(fixture, heldPath);
      fs.writeFileSync(path.join(scratchDir, 'thumbnail-generation-hold'), 'hold the second result');
      reachedPath = path.join(scratchDir, 'thumbnail-generation-reached');
      releasePath = path.join(scratchDir, 'thumbnail-generation-release');
      env.POLYTRAY_THUMBNAIL_TEST_TARGET_PATH = heldPath;
    },
  });
  try {
    const page = await findMainWindow(isolated.app);
    const library = path.dirname(readyPath);
    await page.evaluate((folder) => {
      const current = JSON.parse(localStorage.getItem('polytray-settings') || '{}');
      localStorage.setItem('polytray-settings', JSON.stringify({ ...current, autoScan: false, watch: false }));
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [folder], lastFolder: folder }));
    }, library);
    await page.reload();
    await page.locator('#search-input').waitFor();
    const scan = await page.evaluate(({ folder, runtime }) => window.polytray.scanFolder(folder, runtime), { folder: library, runtime: settings });
    expect(scan.state).toBe('completed');
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const job = (await window.polytray.getBackgroundJobs()).find((item) => item.kind === 'thumbnail');
      return [job?.counts.thumbnailsSucceeded, job?.counts.thumbnailsPending];
    })).toEqual([1, 1]);

    await expect.poll(() => page.evaluate(async ({ folder, filePath }) => {
      const files = (await window.polytray.getFiles({ folder, limit: 10, offset: 0 })).files;
      return files.find((file) => file.path === filePath)?.thumbnail ?? null;
    }, { folder: library, filePath: readyPath }), { timeout: 10_000 }).toBeTruthy();
    await expect(page.locator('.file-card[aria-label="a-ready.stl"] img[data-thumbnail-state]'))
      .toHaveAttribute('data-thumbnail-state', 'ready', { timeout: 10_000 });
    const heldThumbnail = await page.evaluate(async ({ folder, filePath }) => {
      const files = (await window.polytray.getFiles({ folder, limit: 10, offset: 0 })).files;
      return files.find((file) => file.path === filePath)?.thumbnail ?? null;
    }, { folder: library, filePath: heldPath });
    expect(heldThumbnail).toBeNull();

    fs.writeFileSync(releasePath, 'release');
    await expect.poll(() => page.evaluate(async ({ folder, filePath }) => {
      const files = (await window.polytray.getFiles({ folder, limit: 10, offset: 0 })).files;
      return files.find((file) => file.path === filePath)?.thumbnail ?? null;
    }, { folder: library, filePath: heldPath }), { timeout: 30_000 }).toBeTruthy();
  } finally {
    if (releasePath) fs.writeFileSync(releasePath, 'release');
    await isolated.close();
  }
});

test('a failed thumbnail publication keeps progress attached until later items settle', async () => {
  test.setTimeout(90_000);
  const env: NodeJS.ProcessEnv = {};
  let failedPath = '';
  let heldPath = '';
  let reachedPath = '';
  let releasePath = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(process.cwd(), 'out/main/index.js'),
    env,
    beforeLaunch: ({ scratchDir }) => {
      const library = path.join(scratchDir, 'library');
      fs.mkdirSync(library);
      failedPath = path.join(library, 'a-failed.stl');
      heldPath = path.join(library, 'z-held.stl');
      const fixture = path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl');
      fs.copyFileSync(fixture, failedPath);
      fs.copyFileSync(fixture, heldPath);
      fs.writeFileSync(path.join(scratchDir, 'thumbnail-generation-hold'), 'hold the second result');
      reachedPath = path.join(scratchDir, 'thumbnail-generation-reached');
      releasePath = path.join(scratchDir, 'thumbnail-generation-release');
      env.POLYTRAY_THUMBNAIL_TEST_TARGET_PATH = heldPath;
    },
  });
  try {
    const page = await findMainWindow(isolated.app);
    const library = path.dirname(failedPath);
    await page.evaluate((folder) => {
      const current = JSON.parse(localStorage.getItem('polytray-settings') || '{}');
      localStorage.setItem('polytray-settings', JSON.stringify({ ...current, autoScan: false, watch: false }));
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [folder], lastFolder: folder }));
    }, library);
    await page.reload();
    await page.locator('#search-input').waitFor();
    await isolated.app.evaluate((_electron, { databasePath, modulePath, targetPath }) => {
      const nodeModule = process.getBuiltinModule('module');
      const Database = nodeModule?.createRequire(modulePath)('better-sqlite3');
      if (!Database) throw new Error('Electron main process cannot open the isolated test database');
      const db = new Database(databasePath);
      try {
        const quotedPath = targetPath.replaceAll("'", "''");
        db.exec(`CREATE TRIGGER fail_first_thumbnail BEFORE UPDATE OF thumbnail ON files
          WHEN NEW.path = '${quotedPath}' AND NEW.thumbnail IS NOT NULL
          BEGIN SELECT RAISE(FAIL, 'injected thumbnail publication failure'); END`);
      } finally { db.close(); }
    }, { databasePath: path.join(isolated.userDataDir, 'data', 'polytray.db'), modulePath: path.join(process.cwd(), 'package.json'), targetPath: failedPath });
    await page.evaluate(() => {
      const state = window as Window & { __thumbnailProgress?: Array<{ generated: number; pending: number; phase: string }> };
      state.__thumbnailProgress = [];
      window.polytray.onThumbnailProgress((progress) => {
        state.__thumbnailProgress?.push({ generated: progress.generated, pending: progress.pending, phase: progress.phase });
      });
    });
    const scan = await page.evaluate(({ folder, runtime }) => window.polytray.scanFolder(folder, runtime), { folder: library, runtime: settings });
    expect(scan.state).toBe('completed');
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const job = (await window.polytray.getBackgroundJobs()).find((item) => item.kind === 'thumbnail');
      return [job?.counts.thumbnailsSucceeded, job?.counts.thumbnailsPending];
    })).toEqual([1, 1]);
    const firstRow = await page.evaluate(async ({ folder, filePath }) => {
      const files = (await window.polytray.getFiles({ folder, limit: 10, offset: 0 })).files;
      return files.find((file) => file.path === filePath)?.thumbnail ?? null;
    }, { folder: library, filePath: failedPath });
    expect(firstRow).toBeNull();

    fs.writeFileSync(releasePath, 'release');
    await expect.poll(() => page.evaluate(async () => {
      const job = (await window.polytray.getBackgroundJobs()).find((item) => item.kind === 'thumbnail');
      return [job?.state, job?.counts.thumbnailsSucceeded, job?.counts.thumbnailsPending];
    }), { timeout: 30_000 }).toEqual(['completed', 2, 0]);
    await expect.poll(() => page.evaluate(() => {
      const state = window as Window & { __thumbnailProgress?: Array<{ generated: number; pending: number; phase: string }> };
      return state.__thumbnailProgress?.some((item) => item.generated === 2 && item.pending === 0 && item.phase === 'done') ?? false;
    })).toBe(true);
  } finally {
    if (releasePath) fs.writeFileSync(releasePath, 'release');
    await isolated.close();
  }
});
