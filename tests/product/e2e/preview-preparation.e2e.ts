import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';

const APP_DIR = path.resolve(__dirname, '../../..');
const SETTINGS = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 20,
  watcher_stability: 1000,
  page_size: 50,
  thumbnailColor: '#8888aa',
};

function writeDenseBinaryStl(filePath: string, triangleCount: number) {
  const buffer = Buffer.alloc(84 + triangleCount * 50);
  buffer.write('Polytray V04 dense preparation fixture', 0, 'ascii');
  buffer.writeUInt32LE(triangleCount, 80);
  for (let i = 0; i < triangleCount; i++) {
    const offset = 84 + i * 50;
    buffer.writeFloatLE(0, offset); buffer.writeFloatLE(0, offset + 4); buffer.writeFloatLE(-1, offset + 8);
    const x = (i % 100) * 0.01;
    const vertices = [x, 0, 0, x, 1, 0, x, 0, 1];
    vertices.forEach((value, index) => buffer.writeFloatLE(value, offset + 12 + index * 4));
  }
  fs.writeFileSync(filePath, buffer);
}

async function writeMultipart3mf(filePath: string, partCount: number) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);
  const items = Array.from({ length: partCount }, (_, index) =>
    `<item objectid="1" transform="1 0 0 0 1 0 0 0 1 ${index * 3} 0 0"/>`,
  ).join('');
  zip.file('3D/3dmodel.model', `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="0" y="2" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build>${items}</build></model>`);
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function findMainWindow(app: Awaited<ReturnType<typeof launchIsolatedApp>>['app']) {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ timeout: 250 });
        return page;
      } catch { /* Preview and thumbnail renderers do not own the library UI. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Visible main window did not become ready');
}

test('dense and transformed multipart previews report first-frame and render-submit costs', async () => {
  test.setTimeout(180_000);
  let library = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, 'out/main/index.js'),
    beforeLaunch: async ({ scratchDir }) => {
      library = path.join(scratchDir, 'library');
      fs.mkdirSync(library);
      writeDenseBinaryStl(path.join(library, 'dense.stl'), 60_000);
      await writeMultipart3mf(path.join(library, 'multipart.3mf'), 32);
    },
  });

  try {
    const page = await findMainWindow(isolated.app);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#search-input').waitFor();
    await page.evaluate(({ folder, settings }) => window.polytray.scanFolder(folder, settings), { folder: library, settings: SETTINGS });
    await expect(page.locator('#library-result-total')).toContainText('2 models', { timeout: 30000 });

    for (const model of ['dense', 'multipart']) {
      await page.evaluate(() => {
        performance.clearMeasures('polytray-preview-first-render');
        performance.clearMeasures('polytray-preview-render-submit');
        const state = window as Window & { __V04_SAMPLE?: { startedAt: number; longTasks: Array<{ startTime: number; duration: number }> } };
        const sample = { startedAt: performance.now(), longTasks: [] as Array<{ startTime: number; duration: number }> };
        state.__V04_SAMPLE = sample;
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) sample.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }).observe({ type: 'longtask', buffered: false });
      });
      const card = page.locator('.file-card').filter({ has: page.locator(`.card-name[title="${model}"]`) }).first();
      await expect(card).toBeVisible();
      await card.click();
      await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30000 });
      await expect.poll(() => page.evaluate(() => performance.getEntriesByName('polytray-preview-first-render').length), { timeout: 30000 }).toBeGreaterThan(0);
      const result = await page.evaluate(() => {
        const sample = (window as any).__V04_SAMPLE;
        const firstRender = performance.getEntriesByName('polytray-preview-first-render').at(-1);
        const renderSubmit = performance.getEntriesByName('polytray-preview-render-submit').at(-1);
        const firstFrameEnd = firstRender ? firstRender.startTime + firstRender.duration : Number.POSITIVE_INFINITY;
        return {
          firstFrameMs: firstRender?.duration ?? null,
          longestTaskBeforeFirstFrameMs: Math.max(0, ...sample.longTasks.filter((task: any) => task.startTime <= firstFrameEnd).map((task: any) => task.duration)),
          longestTaskAfterStartMs: Math.max(0, ...sample.longTasks.map((task: any) => task.duration)),
          renderSubmitMs: renderSubmit?.duration ?? null,
        };
      });
      console.info(`[V04 metrics] ${model} ${JSON.stringify(result)}`);
      expect(result.firstFrameMs, `${model} should reach a usable frame within the 8ms-sliced assembly window plus background parse`).toBeLessThan(3000);
      expect(result.firstFrameMs).not.toBeNull();
      expect(result.renderSubmitMs).not.toBeNull();
      await page.locator('#btn-close-viewer').click();
      await expect(page.locator('#preview-panel')).toHaveClass(/hidden/);
    }
  } finally {
    await isolated.close();
  }
});
