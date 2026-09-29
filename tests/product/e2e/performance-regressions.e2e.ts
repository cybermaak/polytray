import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';

const SETTINGS = {
  thumbnail_timeout: 20_000, scanning_batch_size: 50, watcher_stability: 1_000,
  page_size: 500, thumbnailColor: '#8888aa',
};

declare global {
  interface Window {
    __G02_CONTEXTS?: WebGLRenderingContext[];
    __G02_FRAME_MARKS?: number;
    __G02_RESOURCES?: { workersCreated: number; workersTerminated: number; channelsCreated: number; channelPortsClosed: number; listenerRegistrations: number; listenerRemovals: number };
    __POLYTRAY_RENDERER_PROBE?: { viewerFrames: number; markViewerFrame(): void; markViewerDrawCalls(count: number): void; drawCalls?: number };
  }
}

function writeTinyStl(filePath: string) {
  fs.writeFileSync(filePath, 'solid cycle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid cycle\n');
}

async function mainWindow(app: Awaited<ReturnType<typeof launchIsolatedApp>>['app']) {
  await app.firstWindow();
  await expect.poll(async () => {
    for (const page of app.windows()) if (await page.locator('#search-input').isVisible().catch(() => false)) return true;
    return false;
  }, { timeout: 15_000 }).toBe(true);
  for (const page of app.windows()) if (await page.locator('#search-input').isVisible().catch(() => false)) return page;
  throw new Error('Main window is not visible');
}

test('performance resource observations stay stable across twenty viewer replacement cycles', async () => {
  test.setTimeout(180_000);
  let library = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(process.cwd(), 'out/main/index.js'),
    beforeLaunch: ({ scratchDir }) => {
      library = path.join(scratchDir, 'library');
      fs.mkdirSync(library);
      writeTinyStl(path.join(library, 'a.stl'));
      writeTinyStl(path.join(library, 'b.stl'));
      fs.writeFileSync(path.join(library, 'multipart.obj'), 'o A\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\no B\nv 2 0 0\nv 3 0 0\nv 2 1 0\nf 4 5 6\n');
    },
  });

  try {
    const page = await mainWindow(isolated.app);
    await page.evaluate(({ root, settings }) => window.polytray.scanFolder(root, settings), { root: library, settings: SETTINGS });
    await expect(page.locator('.file-card')).toHaveCount(3, { timeout: 30_000 });
    await page.evaluate(() => {
      const w = window as Window & {
        __POLYTRAY_RENDERER_PROBE?: { viewerFrames: number; markViewerFrame(): void; markViewerDrawCalls(count: number): void; drawCalls?: number };
        __G02_CONTEXTS?: WebGLRenderingContext[];
        __G02_FRAME_MARKS?: number;
      };
      w.__G02_CONTEXTS = [];
      w.__G02_FRAME_MARKS = 0;
      const resources = { workersCreated: 0, workersTerminated: 0, channelsCreated: 0, channelPortsClosed: 0, listenerRegistrations: 0, listenerRemovals: 0 };
      w.__G02_RESOURCES = resources;
      w.__POLYTRAY_RENDERER_PROBE = {
        viewerFrames: 0,
        markViewerFrame() { this.viewerFrames++; w.__G02_FRAME_MARKS!++; },
        markViewerDrawCalls(count) { this.drawCalls = (this.drawCalls ?? 0) + count; },
      };
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
        const context = original.call(this, type, ...args) as RenderingContext | null;
        if ((type === 'webgl' || type === 'webgl2') && context) w.__G02_CONTEXTS!.push(context as WebGLRenderingContext);
        return context;
      } as typeof HTMLCanvasElement.prototype.getContext;
      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, { construct(target, args, newTarget) {
        resources.workersCreated++;
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        const terminate = worker.terminate.bind(worker);
        let terminated = false;
        worker.terminate = () => { if (!terminated) { terminated = true; resources.workersTerminated++; } terminate(); };
        return worker;
      } });
      const NativeMessageChannel = window.MessageChannel;
      window.MessageChannel = new Proxy(NativeMessageChannel, { construct(target, args, newTarget) {
        resources.channelsCreated++;
        const channel = Reflect.construct(target, args, newTarget) as MessageChannel;
        for (const port of [channel.port1, channel.port2]) {
          const close = port.close.bind(port);
          let closed = false;
          port.close = () => { if (!closed) { closed = true; resources.channelPortsClosed++; } close(); };
        }
        return channel;
      } });
      const addListener = EventTarget.prototype.addEventListener;
      const removeListener = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function(...args) { resources.listenerRegistrations++; return addListener.apply(this, args); };
      EventTarget.prototype.removeEventListener = function(...args) { resources.listenerRemovals++; return removeListener.apply(this, args); };
    });

    const initialWindows = isolated.app.windows().length;
    const imageCacheBytes = () => fs.readdirSync(path.join(isolated.userDataDir, 'thumbnails'), { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.png'))
      .reduce((sum, entry) => sum + fs.statSync(path.join(isolated.userDataDir, 'thumbnails', entry)).size, 0);
    const thumbnailPaths: string[] = [];
    for (const [filename, extension] of [['a.stl', 'stl'], ['b.stl', 'stl'], ['multipart.obj', 'obj']] as const) {
      const thumbPath = await page.evaluate(({ modelPath, extension, settings }) =>
        window.polytray.requestThumbnailGeneration(modelPath, extension, settings), {
        modelPath: path.join(library, filename), extension, settings: SETTINGS,
      });
      expect(thumbPath).toBeTruthy();
      thumbnailPaths.push(thumbPath!);
    }
    const cacheHit = await page.evaluate(({ modelPath, settings }) =>
      window.polytray.requestThumbnailGeneration(modelPath, 'stl', settings), {
      modelPath: path.join(library, 'a.stl'), settings: SETTINGS,
    });
    expect(cacheHit).toBe(thumbnailPaths[0]);
    fs.rmSync(thumbnailPaths[0]);
    const cacheMiss = await page.evaluate(({ modelPath, settings }) =>
      window.polytray.requestThumbnailGeneration(modelPath, 'stl', settings), {
      modelPath: path.join(library, 'a.stl'), settings: SETTINGS,
    });
    expect(cacheMiss).toBe(thumbnailPaths[0]);
    expect(fs.existsSync(cacheMiss!)).toBe(true);
    await page.waitForTimeout(500);
    const cacheBytesAtStart = imageCacheBytes();
    let quietFrameCount = -1;
    let minimizedFrameCount = -1;

    const canvas = page.locator('#viewer-container canvas');
    for (let cycle = 0; cycle < 20; cycle++) {
      const firstName = cycle % 2 === 0 ? 'a' : 'b';
      const replacementName = firstName === 'a' ? 'b' : 'a';
      const firstCard = page.locator('.file-card').filter({ has: page.locator(`.card-name[title="${firstName}"]`) }).first();
      await firstCard.click();
      await expect(canvas).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30_000 });
      await expect(page.locator('#viewer-filename')).toHaveText(`${firstName}.stl`);
      const replacementCard = page.locator('.file-card').filter({ has: page.locator(`.card-name[title="${replacementName}"]`) }).first();
      await replacementCard.click();
      await expect(canvas).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30_000 });
      await expect(page.locator('#viewer-filename')).toHaveText(`${replacementName}.stl`);
      if (cycle === 0) {
        await page.evaluate(() => { window.__G02_FRAME_MARKS = 0; });
        await page.waitForTimeout(1_000);
        quietFrameCount = await page.evaluate(() => window.__G02_FRAME_MARKS ?? -1);
        expect(quietFrameCount).toBe(0);
      }
      if (cycle === 5) {
        const native = await isolated.app.browserWindow(page);
        await native.evaluate((win) => win.minimize());
        await expect.poll(() => native.evaluate((win) => win.isMinimized())).toBe(true);
        await page.evaluate(() => { window.__G02_FRAME_MARKS = 0; });
        await page.waitForTimeout(1_000);
        minimizedFrameCount = await page.evaluate(() => window.__G02_FRAME_MARKS ?? -1);
        expect(minimizedFrameCount).toBe(0);
        await native.evaluate((win) => win.restore());
        await expect.poll(() => native.evaluate((win) => win.isVisible())).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__G02_FRAME_MARKS)).toBeGreaterThan(0);
      }
      await page.locator('#btn-close-viewer').click();
      await expect(canvas).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.__POLYTRAY_CURRENT_MODEL ?? null)).toBeNull();
      expect(isolated.app.windows().length).toBe(initialWindows);
    }

    const resourceSnapshot = await page.evaluate(() => ({
      webglContextsCreated: window.__G02_CONTEXTS?.length ?? 0,
      webglContextsStillUsable: window.__G02_CONTEXTS?.filter((context) => !context.isContextLost()).length ?? 0,
      framesAcrossCyclesAfterQuietCheck: window.__G02_FRAME_MARKS ?? 0,
      ...window.__G02_RESOURCES,
    }));
    const cacheBytesAtEnd = imageCacheBytes();
    console.info('[G02 resource observations]', JSON.stringify({ cycles: 20, openCloseAndReplacementPairs: 20, zeroFramesDuringQuietSecond: quietFrameCount, zeroFramesDuringMinimizedSecond: minimizedFrameCount, ...resourceSnapshot, cacheBytesAtStart, cacheBytesAtEnd, windowCount: initialWindows }));
    expect(resourceSnapshot.webglContextsCreated).toBeGreaterThan(0);
    expect(resourceSnapshot.webglContextsStillUsable).toBe(0);
    expect(resourceSnapshot.workersCreated).toBe(resourceSnapshot.workersTerminated);
    expect(cacheBytesAtEnd).toBe(cacheBytesAtStart);
    expect(isolated.app.windows()).toHaveLength(initialWindows);
  } finally {
    await isolated.close();
  }
});
