import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { ElectronApplication, Page } from 'playwright';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';

declare global {
  interface Window {
    __POLYTRAY_RENDERER_PROBE: { lastViewerFrameAt: number; markViewerFrame(): void; markViewerDrawCalls(): void };
    __POLYTRAY_CURRENT_MODEL?: unknown;
    __V02_CANVAS?: Element | null;
    __V02_MODEL?: unknown;
    __V02_PIXELS?: string;
    __V02_LATEST_MODEL?: unknown;
    __releaseSlowPreviewFetch?: () => void;
    __originalFetch?: typeof fetch;
  }
}

const APP_DIR = path.resolve(__dirname, '../../..');
const SETTINGS = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 500,
  thumbnailColor: '#8888aa',
};

function writeTinyStl(filePath: string, name: string) {
  fs.writeFileSync(filePath, `solid ${name}\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendfacet\nendsolid ${name}\n`);
}

async function writeArchive(filePath: string) {
  const zip = new JSZip();
  for (let index = 0; index < 30; index++) {
    const name = `model-${String(index).padStart(2, '0')}`;
    const stl = index === 0
      ? `solid ${name}\nfacet nonsense\nendsolid ${name}\n`
      : `solid ${name}\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendfacet\nendsolid ${name}\n`;
    zip.file(`models/${name}.stl`, stl);
  }
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function findMainWindow(app: ElectronApplication): Promise<Page> {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ timeout: 200 });
        return page;
      } catch { /* Ignore hidden preview and thumbnail renderers. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Visible main window did not become ready');
}

test('preview metadata, thumbnail arrival, retry, and archive paging preserve viewer identity', async () => {
  test.setTimeout(180_000);
  let libraryRoot = '';
  let missingPath = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, 'out/main/index.js'),
    beforeLaunch: async ({ scratchDir }) => {
      libraryRoot = path.join(scratchDir, 'library');
      fs.mkdirSync(libraryRoot);
      writeTinyStl(path.join(libraryRoot, 'a.stl'), 'a');
      writeTinyStl(path.join(libraryRoot, 'b.stl'), 'b');
      writeTinyStl(path.join(libraryRoot, 'slow.stl'), 'slow');
      missingPath = path.join(libraryRoot, 'retry.stl');
      writeTinyStl(missingPath, 'retry');
      await writeArchive(path.join(libraryRoot, 'library.zip'));
    },
  });

  try {
    const page = await findMainWindow(isolated.app);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#empty-state')).toBeVisible({ timeout: 15000 });
    await page.evaluate(({ folder, settings }) => window.polytray.scanFolder(folder, settings), {
      folder: libraryRoot,
      settings: SETTINGS,
    });
    await expect(page.locator('#library-result-total')).toHaveText('5 items / 34 models', { timeout: 30000 });
    await page.reload();
    await page.locator('#search-input').waitFor();
    await expect(page.locator('#library-result-total')).toHaveText('5 items / 34 models', { timeout: 30000 });
    await page.evaluate(() => {
      const probe = {
        lastViewerFrameAt: Number.NEGATIVE_INFINITY,
        markViewerFrame() { this.lastViewerFrameAt = performance.now(); },
        markViewerDrawCalls() {},
      };
      window.__POLYTRAY_RENDERER_PROBE = probe;
    });
    const records = await page.evaluate((folder) => window.polytray.getFiles({ folder, sort: 'name', order: 'ASC', limit: 100, offset: 0 }), libraryRoot);
    const a = records.files.find((record) => record.name === 'a');
    const b = records.files.find((record) => record.name === 'b');
    const slow = records.files.find((record) => record.name === 'slow');
    const retry = records.files.find((record) => record.name === 'retry');
    expect(a && b && slow && retry).toBeTruthy();
    fs.rmSync(missingPath);

    const card = (name: string) => page.locator('.file-card').filter({ has: page.locator(`.card-name[title="${name}"]`) }).first();
    const clickCard = async (name: string) => {
      const target = card(name);
      await page.locator('#search-input').fill(name);
      await expect(target).toBeVisible({ timeout: 30000 });
      await target.click();
    };
    await clickCard('a');
    const canvas = page.locator('#viewer-container canvas');
    await expect(canvas).toHaveCount(1, { timeout: 15000 });
    await expect.poll(() => page.evaluate(() => Boolean(window.__POLYTRAY_CURRENT_MODEL)), { timeout: 30000 }).toBe(true);
    await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30000 });

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2 + 48, canvasBox!.y + canvasBox!.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => performance.now() - window.__POLYTRAY_RENDERER_PROBE.lastViewerFrameAt), { timeout: 5000 }).toBeGreaterThan(150);
    await page.evaluate(() => {
      window.__V02_CANVAS = document.querySelector('#viewer-container canvas');
      window.__V02_MODEL = window.__POLYTRAY_CURRENT_MODEL;
      window.__V02_PIXELS = (window.__V02_CANVAS as HTMLCanvasElement | null)?.toDataURL();
    });

    await page.locator('#file-tags-input').fill('stable-tag');
    await page.locator('#save-file-tags').click();
    await expect(page.locator('#file-tags')).toContainText('stable-tag');
    await page.locator('#file-notes-input').fill('First line\n  indented note');
    await page.locator('#save-file-notes').click();
    await expect.poll(async () => page.evaluate(async (id) => (await window.polytray.getFileById(id))?.notes, a!.id))
      .toBe('First line\n  indented note');
    await page.locator('#new-collection-name').fill('Preview Saved');
    await page.locator('#create-and-add-collection').click();
    await expect(page.locator('#file-collections')).toContainText('Preview Saved');
    expect(await page.evaluate(() => ({
      sameCanvas: window.__V02_CANVAS === document.querySelector('#viewer-container canvas'),
      sameModel: window.__V02_MODEL === window.__POLYTRAY_CURRENT_MODEL,
      samePixels: window.__V02_PIXELS === (document.querySelector('#viewer-container canvas') as HTMLCanvasElement | null)?.toDataURL(),
    }))).toEqual({ sameCanvas: true, sameModel: true, samePixels: true });
    await page.evaluate((fileId) => window.polytray.updateFileMetadata({ id: fileId, tags: [], notes: '' }), a!.id);
    await page.locator('.context-chip-dismiss[title="Remove collection filter"]').click();
    await expect(page.locator('#toolbar-context')).toContainText('All Models');

    await page.evaluate((settings) => window.polytray.clearThumbnails(settings), SETTINGS);
    await page.evaluate(({ filePath, extension, settings }) =>
      window.polytray.requestThumbnailGeneration(filePath, extension, settings),
    { filePath: a!.path, extension: a!.extension, settings: SETTINGS });
    await expect.poll(async () => page.evaluate(async (id) => Boolean((await window.polytray.getFileById(id))?.thumbnail), a!.id), { timeout: 30000 }).toBe(true);
    expect(await page.evaluate(() => ({
      sameCanvas: window.__V02_CANVAS === document.querySelector('#viewer-container canvas'),
      sameModel: window.__V02_MODEL === window.__POLYTRAY_CURRENT_MODEL,
    }))).toEqual({ sameCanvas: true, sameModel: true });

    await page.evaluate((slowPath) => {
      const view = window as Window & { __releaseSlowPreviewFetch?: () => void; __originalFetch?: typeof fetch };
      const original = window.fetch.bind(window);
      view.__originalFetch = original;
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes(encodeURIComponent(slowPath))) return original(input, init);
        return new Promise<Response>((resolve, reject) => {
          view.__releaseSlowPreviewFetch = () => { void original(input, init).then(resolve, reject); };
        });
      }) as typeof fetch;
    }, slow!.path);
    await clickCard('slow');
    await expect.poll(() => page.evaluate(() => Boolean(window.__releaseSlowPreviewFetch)), { timeout: 10000 }).toBe(true);
    await clickCard('b');
    await expect(page.locator('#viewer-filename')).toHaveText('b.stl');
    await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 15000 });
    await page.evaluate(() => {
      window.__V02_LATEST_MODEL = window.__POLYTRAY_CURRENT_MODEL;
      window.__releaseSlowPreviewFetch?.();
    });
    await page.waitForTimeout(250);
    await expect(page.locator('#viewer-filename')).toHaveText('b.stl');
    expect(await page.evaluate(() => window.__V02_LATEST_MODEL === window.__POLYTRAY_CURRENT_MODEL)).toBe(true);
    await page.evaluate(() => { if (window.__originalFetch) window.fetch = window.__originalFetch; });

    await clickCard('retry');
    await expect(page.locator('#viewer-error')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/);
    writeTinyStl(missingPath, 'retry-restored');
    await page.locator('#btn-retry-preview').click();
    await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30000 });
    await expect(page.locator('#viewer-error')).toHaveCount(0);
    await expect(page.locator('#viewer-filename')).toHaveText('retry.stl');

    await page.locator('#btn-close-viewer').click();
    await page.locator('#search-clear').click();
    await expect(page.locator('#search-input')).toHaveValue('');
    const archiveCard = page.locator('.file-card.archive-summary').filter({ has: page.locator('.card-name[title="library.zip"]') });
    await expect(archiveCard).toBeVisible({ timeout: 30000 });
    await archiveCard.click();
    await expect(page.locator('#archive-preview-count')).toHaveText('1 of 30 models', { timeout: 30000 });
    const archiveModelButtons = page.locator('#archive-preview-models .multi-model-thumb[title$=".stl"]');
    await expect(archiveModelButtons).toHaveCount(24);
    await expect(page.locator('#viewer-error')).toBeVisible({ timeout: 15000 });
    await archiveModelButtons.nth(1).click();
    await expect(page.locator('#viewer-error')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('#viewer-meta')).toContainText('Viewing: model-01.stl');
    await archiveModelButtons.nth(23).click();
    await page.locator('#archive-preview-next').click();
    await expect(page.locator('#archive-preview-count')).toHaveText('25 of 30 models', { timeout: 15000 });
    await expect(archiveModelButtons).toHaveCount(6);
    await archiveModelButtons.nth(5).click();
    await expect(page.locator('#archive-preview-count')).toHaveText('30 of 30 models');
    await expect(page.locator('#archive-preview-next')).toBeDisabled();
    for (let step = 0; step < 6; step += 1) await page.locator('#archive-preview-previous').click();
    await expect(page.locator('#archive-preview-count')).toHaveText('24 of 30 models', { timeout: 15000 });
    await expect(archiveModelButtons).toHaveCount(24, { timeout: 15000 });
  } finally {
    await isolated.close();
  }
});
