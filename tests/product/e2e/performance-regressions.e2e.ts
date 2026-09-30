import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';
import {
  THUMBNAIL_IMAGE_CACHE_DIAGNOSTICS_SESSION_KEY,
  type ThumbnailImageCacheStats,
} from '../../../src/renderer/lib/thumbnailImageCache';

const SETTINGS = {
  thumbnail_timeout: 20_000, scanning_batch_size: 50, watcher_stability: 1_000,
  page_size: 500, thumbnailColor: '#8888aa',
};

declare global {
  var __POLYTRAY_ISOLATED_UTILITY_PROCESS_METRICS: {
    started: number;
    exited: number;
    peakActive: number;
    active: Array<{ pid: number; serviceName: string }>;
  } | undefined;
  interface Window {
    __G02_CONTEXTS?: WebGLRenderingContext[];
    __G02_FRAME_MARKS?: number;
    __G02_RESOURCES?: { workersCreated: number; workersTerminated: number; channelsCreated: number; channelPortsClosed: number; listenerRegistrations: number; listenerRemovals: number };
    __POLYTRAY_RENDERER_PROBE?: { viewerFrames: number; markViewerFrame(): void; markViewerDrawCalls(count: number): void; drawCalls?: number };
    __POLYTRAY_TEST_THUMBNAIL_IMAGE_CACHE_STATS__?: () => Readonly<ThumbnailImageCacheStats>;
  }
}

function writeTinyStl(filePath: string) {
  fs.writeFileSync(filePath, 'solid cycle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid cycle\n');
}

async function writeTiny3mf(filePath: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`);
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
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
  let utilityPidsAtCycleEnd: number[] = [];
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(process.cwd(), 'out/main/index.js'),
    env: { POLYTRAY_UTILITY_PROCESS_METRICS: '1' },
    beforeLaunch: async ({ scratchDir }) => {
      library = path.join(scratchDir, 'library');
      fs.mkdirSync(library);
      writeTinyStl(path.join(library, 'a.stl'));
      writeTinyStl(path.join(library, 'b.stl'));
      await writeTiny3mf(path.join(library, 'cycle.3mf'));
      fs.writeFileSync(path.join(library, 'multipart.obj'), 'o A\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\no B\nv 2 0 0\nv 3 0 0\nv 2 1 0\nf 4 5 6\n');
    },
  });

  try {
    const page = await mainWindow(isolated.app);
    await page.evaluate((key) => sessionStorage.setItem(key, 'enabled'), THUMBNAIL_IMAGE_CACHE_DIAGNOSTICS_SESSION_KEY);
    await page.reload();
    await expect(page.locator('#search-input')).toBeAttached();
    await expect.poll(() => page.evaluate(() => typeof window.__POLYTRAY_TEST_THUMBNAIL_IMAGE_CACHE_STATS__)).toBe('function');
    await page.evaluate(({ root, settings }) => window.polytray.scanFolder(root, settings), { root: library, settings: SETTINGS });
    await expect(page.locator('.file-card')).toHaveCount(4, { timeout: 30_000 });
    const utilityProcessesBeforeCycles = await isolated.app.evaluate(() => {
      const metrics = globalThis.__POLYTRAY_ISOLATED_UTILITY_PROCESS_METRICS;
      if (!metrics) throw new Error('Isolated utility-process metrics are not installed');
      return { ...metrics, active: metrics.active.map((process) => ({ ...process })) };
    });
    expect(utilityProcessesBeforeCycles.started).toBeGreaterThan(0);
    expect(utilityProcessesBeforeCycles.active.length).toBeGreaterThan(0);
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

    let initialWindows: number | null = null;
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
    const imageCacheStatsAtStart = await page.evaluate(() => window.__POLYTRAY_TEST_THUMBNAIL_IMAGE_CACHE_STATS__!());
    expect(imageCacheStatsAtStart.completedEntries).toBeGreaterThan(0);
    expect(imageCacheStatsAtStart.completedEntries).toBeLessThanOrEqual(imageCacheStatsAtStart.maxEntries);
    expect(imageCacheStatsAtStart.encodedDataUrlBytes).toBeLessThanOrEqual(imageCacheStatsAtStart.maxEncodedBytes);
    expect(imageCacheStatsAtStart.inFlightEntries).toBe(0);
    let quietFrameCount = -1;
    let minimizedFrameCount = -1;
    let threeMfRequests = 0;
    const cycleDurationsMs: number[] = [];
    const readPreviewResources = async () => {
      const previewPage = isolated.app.windows().find((candidate) => candidate.url().includes('preview.html'));
      const [mainBridge, hiddenBridge, main] = await Promise.all([
        page.evaluate(() => window.polytray.__previewParsePendingCounts?.()),
        previewPage ? previewPage.evaluate(() => window.polytray.__previewParsePendingCounts?.()) : Promise.resolve(null),
        isolated.app.evaluate(() => {
          const read = (globalThis as unknown as { __POLYTRAY_ISOLATED_PREVIEW_PARSE_METRICS?: () => Record<string, number> }).__POLYTRAY_ISOLATED_PREVIEW_PARSE_METRICS;
          return read?.() ?? null;
        }),
      ]);
      return { mainBridge, hiddenBridge, main };
    };
    const settledPreviewResources = {
      mainBridge: { parses: 0, archiveReads: 0, hiddenPorts: 0, hiddenParseListeners: 0 },
      hiddenBridge: { parses: 0, archiveReads: 0, hiddenPorts: 0, hiddenParseListeners: 1 },
      main: {
        jobs: 0, activeJobs: 0, queuedJobs: 0, replyPorts: 0, jobTimers: 0,
        archiveReads: 0, tombstones: 0, tombstoneTimers: 0,
        settlements: 0, settlementTimers: 0, requesterListenerOwners: 1, previewWindows: 1,
      },
    };
    const expectPreviewResourcesSettled = async () => {
      await expect.poll(readPreviewResources, { timeout: 12_000 }).toMatchObject(settledPreviewResources);
      return readPreviewResources();
    };
    const previewOwnershipSamples: Array<Awaited<ReturnType<typeof readPreviewResources>>> = [];

    const canvas = page.locator('#viewer-container canvas');
    for (let cycle = 0; cycle < 20; cycle++) {
      const cycleStartedAt = Date.now();
      const firstCard = page.locator('.file-card').filter({ has: page.locator('.card-name[title="cycle"]') }).first();
      await firstCard.click();
      await expect(canvas).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30_000 });
      await expect(page.locator('#viewer-filename')).toHaveText('cycle.3mf');
      const previewPage = isolated.app.windows().find((candidate) => candidate.url().includes('preview.html'));
      expect(previewPage, 'the owned 3MF preview renderer exists').toBeTruthy();
      if (cycle === 0) initialWindows = isolated.app.windows().length;
      expect(isolated.app.windows().length).toBe(initialWindows);
      const after3mf = await expectPreviewResourcesSettled();
      previewOwnershipSamples.push(after3mf);
      expect(after3mf.hiddenBridge?.hiddenParseListeners).toBe(settledPreviewResources.hiddenBridge.hiddenParseListeners);
      threeMfRequests++;

      const replacementName = cycle % 2 === 0 ? 'a' : 'b';
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
      const afterClose = await expectPreviewResourcesSettled();
      previewOwnershipSamples.push(afterClose);
      expect(isolated.app.windows().length).toBe(initialWindows);
      cycleDurationsMs.push(Date.now() - cycleStartedAt);
      expect(isolated.app.windows().length).toBe(initialWindows);
    }

    const resourceSnapshot = await page.evaluate(() => ({
      webglContextsCreated: window.__G02_CONTEXTS?.length ?? 0,
      webglContextsStillUsable: window.__G02_CONTEXTS?.filter((context) => !context.isContextLost()).length ?? 0,
      framesAcrossCyclesAfterQuietCheck: window.__G02_FRAME_MARKS ?? 0,
      ...window.__G02_RESOURCES,
    }));
    expect(threeMfRequests).toBe(20);
    expect(previewOwnershipSamples).toHaveLength(40);
    const mainListenerOwners = [...new Set(previewOwnershipSamples.map((snapshot) => snapshot.main?.requesterListenerOwners ?? null))];
    const hiddenParseListenerCounts = [...new Set(previewOwnershipSamples.map((snapshot) => snapshot.hiddenBridge?.hiddenParseListeners ?? null))];
    expect(mainListenerOwners).toEqual([1]);
    expect(hiddenParseListenerCounts).toEqual([1]);
    const previewOwnershipEvidence = {
      settledSamples: previewOwnershipSamples.length,
      maxRequesterReplyPorts: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.main?.replyPorts ?? -1)),
      maxPreviewJobs: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.main?.jobs ?? -1)),
      maxPreviewJobTimers: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.main?.jobTimers ?? -1)),
      maxArchiveReads: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.main?.archiveReads ?? -1)),
      maxTombstones: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.main?.tombstones ?? -1)),
      maxSettlementTimers: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.main?.settlementTimers ?? -1)),
      maxMainBridgePendingParses: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.mainBridge?.parses ?? -1)),
      maxHiddenBridgePorts: Math.max(...previewOwnershipSamples.map((snapshot) => snapshot.hiddenBridge?.hiddenPorts ?? -1)),
      mainRequesterListenerOwnerCounts: mainListenerOwners,
      hiddenParseListenerCounts,
    };
    expect(previewOwnershipEvidence.maxRequesterReplyPorts).toBe(0);
    expect(previewOwnershipEvidence.maxPreviewJobs).toBe(0);
    expect(previewOwnershipEvidence.maxPreviewJobTimers).toBe(0);
    expect(previewOwnershipEvidence.maxArchiveReads).toBe(0);
    expect(previewOwnershipEvidence.maxTombstones).toBe(0);
    expect(previewOwnershipEvidence.maxSettlementTimers).toBe(0);
    expect(previewOwnershipEvidence.maxMainBridgePendingParses).toBe(0);
    expect(previewOwnershipEvidence.maxHiddenBridgePorts).toBe(0);
    const utilityProcessesAfterCycles = await isolated.app.evaluate(() => {
      const metrics = globalThis.__POLYTRAY_ISOLATED_UTILITY_PROCESS_METRICS;
      if (!metrics) throw new Error('Isolated utility-process metrics disappeared');
      return { ...metrics, active: metrics.active.map((process) => ({ ...process })) };
    });
    utilityPidsAtCycleEnd = utilityProcessesAfterCycles.active.map((process) => process.pid);
    expect(utilityProcessesAfterCycles.started).toBe(utilityProcessesBeforeCycles.started);
    expect(utilityProcessesAfterCycles.active).toEqual(utilityProcessesBeforeCycles.active);
    const cacheBytesAtEnd = imageCacheBytes();
    const imageCacheStatsAtEnd = await page.evaluate(() => window.__POLYTRAY_TEST_THUMBNAIL_IMAGE_CACHE_STATS__!());
    expect(imageCacheStatsAtEnd.completedEntries).toBeLessThanOrEqual(imageCacheStatsAtEnd.maxEntries);
    expect(imageCacheStatsAtEnd.encodedDataUrlBytes).toBeLessThanOrEqual(imageCacheStatsAtEnd.maxEncodedBytes);
    expect(imageCacheStatsAtEnd.inFlightEntries).toBe(0);
    expect(imageCacheStatsAtEnd.completedEntries).toBe(imageCacheStatsAtStart.completedEntries);
    expect(imageCacheStatsAtEnd.encodedDataUrlBytes).toBe(imageCacheStatsAtStart.encodedDataUrlBytes);
    console.info('[G02 resource observations]', JSON.stringify({ cycles: 20, actual3MfRequests: threeMfRequests, openReplaceCloseCycles: 20, maxOpenReplaceCloseMs: Math.max(...cycleDurationsMs), zeroFramesDuringQuietSecond: quietFrameCount, zeroFramesDuringMinimizedSecond: minimizedFrameCount, ...resourceSnapshot, previewOwnershipEvidence, utilityProcesses: utilityProcessesAfterCycles, cacheBytesAtStart, cacheBytesAtEnd, imageCacheStatsAtStart, imageCacheStatsAtEnd, windowCount: initialWindows }));
    expect(resourceSnapshot.webglContextsCreated).toBeGreaterThan(0);
    expect(resourceSnapshot.webglContextsStillUsable).toBe(0);
    expect(resourceSnapshot.workersCreated).toBe(resourceSnapshot.workersTerminated);
    expect(cacheBytesAtEnd).toBe(cacheBytesAtStart);
    expect(initialWindows).not.toBeNull();
    expect(isolated.app.windows()).toHaveLength(initialWindows!);
  } finally {
    await isolated.close();
  }
  const stillRunningUtilityPids = utilityPidsAtCycleEnd.filter((pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
  });
  expect(stillRunningUtilityPids).toEqual([]);
});
