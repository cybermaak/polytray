import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';
import { installShutdownEvidence } from '../../support/helpers/shutdownEvidence';
import { attachGridFailureEvidence } from '../../support/helpers/gridFailureEvidence';

const APP_DIR = path.resolve(__dirname, '../../..');
const SETTINGS = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 20,
  watcher_stability: 1000,
  page_size: 50,
  thumbnailColor: '#8888aa',
};

interface GpuUploadProbe {
  armed: boolean;
  contextType: 'webgl1' | 'webgl2' | null;
  timerQueryExtension: string | null;
  supported: boolean | null;
  queryStarted: boolean;
  queryEndedBeforeFirstDraw: boolean;
  queryEndStatus: 'not-started' | 'ended-before-first-draw' | 'end-failed';
  methodsRestored: boolean;
  bufferApiPayloadOrAllocationBytes: number;
  cpuUploadCallSpanMs: number | null;
  timerApi: 'webgl1' | 'webgl2' | null;
  context?: WebGLRenderingContext | WebGL2RenderingContext;
  extension?: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
    QUERY_RESULT_AVAILABLE_EXT?: number;
    QUERY_RESULT_EXT?: number;
    createQueryEXT?: () => unknown;
    beginQueryEXT?: (target: number, query: unknown) => void;
    endQueryEXT?: (target: number) => void;
    getQueryObjectEXT?: (query: unknown, parameter: number) => unknown;
    deleteQueryEXT?: (query: unknown) => void;
  };
  query?: unknown;
  uploadStartedAt?: number;
}

declare global {
  interface Window { __G02_GPU_UPLOAD_PROBE?: GpuUploadProbe; }
}

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

async function writeFallback3mf(filePath: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);
  zip.file('3D/3dmodel.model', `<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><colorgroup id="2"><color color="#FF0000"/></colorgroup><object id="1" type="model" pid="2" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="2" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`);
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
      writeDenseBinaryStl(path.join(library, 'dense.stl'), 250_000);
      await writeMultipart3mf(path.join(library, 'multipart.3mf'), 32);
      await writeFallback3mf(path.join(library, 'fallback.3mf'));
    },
  });
  let closeWithEvidence: Awaited<ReturnType<typeof installShutdownEvidence>> | null = null;

  try {
    closeWithEvidence = await installShutdownEvidence(isolated.app, test.info().outputPath('shutdown-evidence.jsonl'), isolated.userDataDir);
    const page = await findMainWindow(isolated.app);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#search-input').waitFor();
    await page.evaluate(({ folder, settings }) => window.polytray.scanFolder(folder, settings), { folder: library, settings: SETTINGS });
    await expect(page.locator('#library-result-total')).toContainText('3 models', { timeout: 30000 });
    await page.evaluate(() => {
      const contextWindow = window as Window & { __V05_WEBGL_CONTEXTS?: Array<WebGLRenderingContext | WebGL2RenderingContext> };
      const probeWindow = window as Window & {
        __V05_PROBE?: {
          inactive: boolean;
          pendingBlobs: number;
          lateBlobs: number;
          latePublications: number;
          lifecycle: Array<{ renderer: boolean; camera: boolean; cleanupCount: number }>;
        };
      };
      contextWindow.__V05_WEBGL_CONTEXTS = [];
      const gpuUploadProbe: GpuUploadProbe = {
        armed: false, contextType: null, timerQueryExtension: null, supported: null,
        queryStarted: false, queryEndedBeforeFirstDraw: false, queryEndStatus: 'not-started', methodsRestored: false, bufferApiPayloadOrAllocationBytes: 0,
        cpuUploadCallSpanMs: null, timerApi: null,
      };
      window.__G02_GPU_UPLOAD_PROBE = gpuUploadProbe;
      const probe = { inactive: false, pendingBlobs: 0, lateBlobs: 0, latePublications: 0, lifecycle: [] as Array<{ renderer: boolean; camera: boolean; cleanupCount: number }> };
      probeWindow.__V05_PROBE = probe;
      (window as Window & { __POLYTRAY_RENDERER_PROBE?: { markPartThumbnailLifecycle?: (renderer: boolean, camera: boolean, cleanupCount: number) => void } }).__POLYTRAY_RENDERER_PROBE = {
        markPartThumbnailLifecycle: (renderer, camera, cleanupCount) => probe.lifecycle.push({ renderer, camera, cleanupCount }),
      };
      window.addEventListener('polytray-part-thumbnail', (event) => {
        const detail = (event as CustomEvent<{ url: string | null }>).detail;
        if (probe.inactive && detail.url) probe.latePublications++;
      });
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        probe.pendingBlobs++;
        setTimeout(() => {
          originalToBlob.call(this, (blob) => {
            probe.pendingBlobs--;
            if (probe.inactive) probe.lateBlobs++;
            callback(blob);
          }, type, quality);
        }, 1200);
      };
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
        const context = original.call(this, type, ...args) as RenderingContext | null;
        if ((type === 'webgl' || type === 'webgl2') && context) {
          const gl = context as WebGLRenderingContext | WebGL2RenderingContext;
          contextWindow.__V05_WEBGL_CONTEXTS!.push(gl);
          if (gpuUploadProbe.armed) {
            gpuUploadProbe.armed = false;
            const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
            const extensionName = isWebGL2 ? 'EXT_disjoint_timer_query_webgl2' : 'EXT_disjoint_timer_query';
            const extension = gl.getExtension(extensionName) as GpuUploadProbe['extension'] ?? undefined;
            gpuUploadProbe.context = gl;
            gpuUploadProbe.contextType = isWebGL2 ? 'webgl2' : 'webgl1';
            gpuUploadProbe.timerQueryExtension = extensionName;
            gpuUploadProbe.supported = Boolean(extension);
            gpuUploadProbe.extension = extension;
            gpuUploadProbe.timerApi = isWebGL2 ? 'webgl2' : 'webgl1';
            if (extension) {
              const raw = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
              const byteLength = (value: unknown) => {
                if (typeof value === 'number') return value;
                if (value instanceof ArrayBuffer) return value.byteLength;
                return ArrayBuffer.isView(value) ? value.byteLength : 0;
              };
              const restoreWrappedMethods: Array<() => void> = [];
              const restoreMethods = () => {
                if (gpuUploadProbe.methodsRestored) return;
                for (const restore of restoreWrappedMethods.splice(0).reverse()) restore();
                gpuUploadProbe.methodsRestored = true;
              };
              const beginQuery = () => {
                if (gpuUploadProbe.queryStarted || !gpuUploadProbe.supported) return;
                let query: unknown;
                try {
                  query = isWebGL2
                    ? (gl as WebGL2RenderingContext).createQuery()
                    : extension.createQueryEXT?.();
                  if (!query) return;
                  gpuUploadProbe.query = query;
                  if (isWebGL2) (gl as WebGL2RenderingContext).beginQuery(extension.TIME_ELAPSED_EXT, query as WebGLQuery);
                  else extension.beginQueryEXT?.(extension.TIME_ELAPSED_EXT, query);
                  gpuUploadProbe.queryStarted = true;
                  gpuUploadProbe.uploadStartedAt = performance.now();
                } catch (error) {
                  try {
                    if (query) {
                      if (isWebGL2) (gl as WebGL2RenderingContext).deleteQuery(query as WebGLQuery);
                      else extension.deleteQueryEXT?.(query);
                    }
                  } catch { /* The context may already be lost. */ }
                  gpuUploadProbe.query = undefined;
                  gpuUploadProbe.supported = false;
                  (gpuUploadProbe as GpuUploadProbe & { instrumentationError?: string }).instrumentationError = String(error);
                }
              };
              const wrapUpload = (name: 'bufferData' | 'bufferSubData', dataArgument: number) => {
                const originalMethod = raw[name].bind(gl);
                const ownDescriptor = Object.getOwnPropertyDescriptor(gl, name);
                Object.defineProperty(gl, name, {
                  configurable: true,
                  value: (...callArgs: unknown[]) => {
                    beginQuery();
                    gpuUploadProbe.bufferApiPayloadOrAllocationBytes += byteLength(callArgs[dataArgument]);
                    return originalMethod(...callArgs);
                  },
                });
                restoreWrappedMethods.push(() => {
                  if (ownDescriptor) Object.defineProperty(gl, name, ownDescriptor);
                  else delete (gl as unknown as Record<string, unknown>)[name];
                });
              };
              const endBeforeDraw = (name: 'drawArrays' | 'drawElements' | 'drawRangeElements') => {
                const originalMethod = raw[name];
                if (typeof originalMethod !== 'function') return;
                const bound = originalMethod.bind(gl);
                Object.defineProperty(gl, name, {
                  configurable: true,
                  value: (...callArgs: unknown[]) => {
                    try {
                      if (gpuUploadProbe.queryStarted && !gpuUploadProbe.queryEndedBeforeFirstDraw) {
                        try {
                          if (isWebGL2) (gl as WebGL2RenderingContext).endQuery(extension.TIME_ELAPSED_EXT);
                          else extension.endQueryEXT?.(extension.TIME_ELAPSED_EXT);
                          gpuUploadProbe.queryEndedBeforeFirstDraw = true;
                          gpuUploadProbe.queryEndStatus = 'ended-before-first-draw';
                        } catch (error) {
                          gpuUploadProbe.queryEndStatus = 'end-failed';
                          (gpuUploadProbe as GpuUploadProbe & { queryError?: string }).queryError = `endQuery failed before first draw: ${String(error)}`;
                          // Retry once to avoid leaving an active query in the viewer if the first end call failed transiently.
                          try {
                            if (isWebGL2) (gl as WebGL2RenderingContext).endQuery(extension.TIME_ELAPSED_EXT);
                            else extension.endQueryEXT?.(extension.TIME_ELAPSED_EXT);
                            gpuUploadProbe.queryEndStatus = 'ended-before-first-draw';
                            gpuUploadProbe.queryEndedBeforeFirstDraw = true;
                          } catch (retryError) {
                            (gpuUploadProbe as GpuUploadProbe & { queryError?: string }).queryError += `; retry failed: ${String(retryError)}`;
                          }
                        }
                        gpuUploadProbe.cpuUploadCallSpanMs = performance.now() - (gpuUploadProbe.uploadStartedAt ?? performance.now());
                      }
                    } finally {
                      restoreMethods();
                    }
                    return bound(...callArgs);
                  },
                });
                restoreWrappedMethods.push(() => {
                  if (ownDescriptor) Object.defineProperty(gl, name, ownDescriptor);
                  else delete (gl as unknown as Record<string, unknown>)[name];
                });
              };
              try {
                wrapUpload('bufferData', 1);
                wrapUpload('bufferSubData', 2);
                endBeforeDraw('drawArrays');
                endBeforeDraw('drawElements');
                endBeforeDraw('drawRangeElements');
              } catch (error) {
                restoreMethods();
                gpuUploadProbe.supported = false;
                (gpuUploadProbe as GpuUploadProbe & { instrumentationError?: string }).instrumentationError = String(error);
              }
            }
          }
        }
        return context;
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    const fallbackPreview = await page.evaluate(async (folder) => {
      const page = await window.polytray.getFiles({ folder, limit: 20, offset: 0 });
      const source = page.files.find((file) => file.name === 'fallback');
      if (!source) throw new Error('Fallback fixture was not indexed');
      return window.polytray.requestPreviewParse({
        requestId: 'v04-fallback-measurement',
        path: source.path,
        extension: source.extension,
        contentRevision: source.content_revision,
      });
    }, library);
    expect(fallbackPreview.meshes.length).toBeGreaterThan(0);
    expect(fallbackPreview.measurements).toMatchObject({
      x: null, y: null, z: null, unit: 'mm', basis: 'source-build', status: 'unavailable',
    });

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
      const contextStart = await page.evaluate(() => (window as Window & { __V05_WEBGL_CONTEXTS?: WebGLRenderingContext[] }).__V05_WEBGL_CONTEXTS?.length ?? 0);
      if (model === 'dense') {
        await page.evaluate(() => {
          const probe = window.__G02_GPU_UPLOAD_PROBE;
          if (probe) probe.armed = true;
        });
      }
      await card.click();
      await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30000 });
      if (model === 'multipart') {
        await expect(page.getByRole('group', { name: 'Model parts' })).toBeVisible();
      }
      const gpuTimerCapability = await page.evaluate((start) => {
        const contexts = ((window as Window & { __V05_WEBGL_CONTEXTS?: Array<WebGLRenderingContext | WebGL2RenderingContext> }).__V05_WEBGL_CONTEXTS ?? []).slice(start);
        return contexts.map((context) => {
          const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
          const extensionName = isWebGL2 ? 'EXT_disjoint_timer_query_webgl2' : 'EXT_disjoint_timer_query';
          const timerExtension = context.getExtension(extensionName) as ({
            TIME_ELAPSED_EXT?: number;
            GPU_DISJOINT_EXT?: number;
          } & WebGLExtension) | null;
          return {
            contextType: isWebGL2 ? 'webgl2' : 'webgl1',
            timerQueryExtension: extensionName,
            supported: Boolean(timerExtension),
            timeElapsedEnum: timerExtension?.TIME_ELAPSED_EXT ?? null,
            gpuDisjointEnum: timerExtension?.GPU_DISJOINT_EXT ?? null,
          };
        });
      }, contextStart);
      console.info(`[G02 GPU timer-query capability] ${model} ${JSON.stringify(gpuTimerCapability)}`);
      expect(await page.evaluate(() => performance.getEntriesByName('polytray-preview-first-render').length)).toBeGreaterThan(0);
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
      if (model === 'dense') {
        const gpuUpload = await page.evaluate(async () => {
          const probe = window.__G02_GPU_UPLOAD_PROBE;
          if (!probe) return { status: 'probe-not-installed' as const };
          const common = {
            contextType: probe.contextType,
            timerQueryExtension: probe.timerQueryExtension,
            extensionSupported: probe.supported,
            queryStarted: probe.queryStarted,
            queryEndedBeforeFirstDraw: probe.queryEndedBeforeFirstDraw,
            bufferApiPayloadOrAllocationBytes: probe.bufferApiPayloadOrAllocationBytes,
            cpuUploadCallSpanMs: probe.cpuUploadCallSpanMs,
            instrumentationMethodsRestored: probe.methodsRestored,
            instrumentationError: (probe as GpuUploadProbe & { instrumentationError?: string }).instrumentationError ?? null,
          };
          if (!probe.supported || !probe.context || !probe.extension || !probe.queryStarted || !probe.query) {
            return { ...common, status: 'timer-query-unavailable-or-not-started' as const, queryAvailable: false, gpuDisjoint: null, gpuElapsedNs: null };
          }
          const context = probe.context;
          const extension = probe.extension;
          const query = probe.query;
          const isWebGL2 = probe.timerApi === 'webgl2';
          const webgl2 = context as WebGL2RenderingContext;
          const queryObject = query as WebGLQuery;
          const isAvailable = () => isWebGL2
            ? Boolean(webgl2.getQueryParameter(queryObject, webgl2.QUERY_RESULT_AVAILABLE))
            : Boolean(extension.getQueryObjectEXT?.(query, extension.QUERY_RESULT_AVAILABLE_EXT ?? 0));
          const deadline = Date.now() + 3_000;
          let queryAvailable = false;
          let gpuDisjoint: boolean | null = null;
          let gpuElapsedNs: number | null = null;
          let queryError: string | null = null;
          try {
            while (Date.now() < deadline) {
              queryAvailable = isAvailable();
              if (queryAvailable) break;
              await new Promise((resolve) => setTimeout(resolve, 16));
            }
            if (queryAvailable) {
              gpuDisjoint = Boolean(context.getParameter(extension.GPU_DISJOINT_EXT));
              if (!gpuDisjoint) {
                gpuElapsedNs = Number(isWebGL2
                  ? webgl2.getQueryParameter(queryObject, webgl2.QUERY_RESULT)
                  : extension.getQueryObjectEXT?.(query, extension.QUERY_RESULT_EXT ?? 0));
              }
            }
          } catch (error) {
            queryError = String(error);
          } finally {
            try {
              if (isWebGL2) webgl2.deleteQuery(queryObject);
              else extension.deleteQueryEXT?.(query);
            } catch (error) {
              queryError ??= `query cleanup failed: ${String(error)}`;
            }
            probe.query = undefined;
          }
          const finiteNonnegative = gpuElapsedNs !== null && Number.isFinite(gpuElapsedNs) && gpuElapsedNs >= 0;
          const status = queryError ? 'query-error' as const
            : !queryAvailable ? 'query-unavailable' as const
              : gpuDisjoint ? 'disjoint' as const
                : !probe.queryEndedBeforeFirstDraw || !finiteNonnegative || probe.bufferApiPayloadOrAllocationBytes <= 0
                  ? 'invalid-result' as const : 'valid' as const;
          return { ...common, status, queryAvailable, gpuDisjoint, gpuElapsedNs, queryError };
        });
        console.info(`[G02 GPU upload] dense ${JSON.stringify({ ...gpuUpload, cpuRenderSubmitMs: result.renderSubmitMs })}`);
        if (gpuUpload.queryStarted) {
          expect(gpuUpload.queryEndedBeforeFirstDraw).toBe(true);
          expect(gpuUpload.instrumentationMethodsRestored).toBe(true);
        }
        if (gpuUpload.status === 'valid') {
          expect(gpuUpload.bufferApiPayloadOrAllocationBytes).toBeGreaterThan(0);
          expect(Number.isFinite(gpuUpload.gpuElapsedNs)).toBe(true);
          expect(gpuUpload.gpuElapsedNs).toBeGreaterThanOrEqual(0);
        }
      }
      if (model === 'multipart') {
        const progressive = await page.evaluate(async () => {
          return new Promise<{ ready: boolean; placeholders: number; inFlight: number }>((resolve) => {
            const check = () => {
              const probe = (window as Window & { __V05_PROBE?: { pendingBlobs: number } }).__V05_PROBE;
              const buttons = [...document.querySelectorAll('#viewer-multi-model .multi-model-thumb')];
              const placeholders = buttons.filter((button) => button.querySelector('[data-part-thumbnail="placeholder"]')).length;
              if (document.querySelector('#viewer-loading')?.classList.contains('hidden') && placeholders > 0 && (probe?.pendingBlobs ?? 0) > 0) {
                resolve({ ready: true, placeholders, inFlight: probe!.pendingBlobs });
                return;
              }
              requestAnimationFrame(check);
            };
            check();
          });
        });
        expect(progressive.ready).toBe(true);
        expect(progressive.placeholders).toBeGreaterThan(0);
        expect(progressive.inFlight).toBeGreaterThan(0);
        const viewerCanvas = page.locator('#viewer-container canvas');
        const frameBeforeThumbnail = await viewerCanvas.screenshot();
        const visibilityBeforeThumbnail = await page.evaluate(() => {
          const model = (window as Window & { __POLYTRAY_CURRENT_MODEL?: { children: Array<{ visible: boolean }> } }).__POLYTRAY_CURRENT_MODEL;
          return model?.children.map((part) => part.visible) ?? [];
        });
        await expect(page.locator('#viewer-multi-model [data-part-thumbnail="ready"]').first()).toBeVisible({ timeout: 15000 });
        const frameAfterThumbnail = await viewerCanvas.screenshot();
        const visibilityAfterThumbnail = await page.evaluate(() => {
          const model = (window as Window & { __POLYTRAY_CURRENT_MODEL?: { children: Array<{ visible: boolean }> } }).__POLYTRAY_CURRENT_MODEL;
          return model?.children.map((part) => part.visible) ?? [];
        });
        expect(frameAfterThumbnail.equals(frameBeforeThumbnail)).toBe(true);
        expect(visibilityAfterThumbnail).toEqual(visibilityBeforeThumbnail);

        const pendingBeforeReplacement = await page.evaluate(() => (window as Window & { __V05_PROBE?: { pendingBlobs: number } }).__V05_PROBE?.pendingBlobs ?? 0);
        expect(pendingBeforeReplacement).toBeGreaterThan(0);
        const replacementBaseline = await page.evaluate(() => {
          const probe = (window as Window & { __V05_PROBE?: { lateBlobs: number; latePublications: number } }).__V05_PROBE!;
          return { callbacks: probe.lateBlobs, publications: probe.latePublications };
        });
        await page.evaluate(() => { (window as Window & { __V05_PROBE?: { inactive: boolean } }).__V05_PROBE!.inactive = true; });
        const denseCard = page.locator('.file-card').filter({ has: page.locator('.card-name[title="dense"]') }).first();
        await denseCard.click();
        await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30000 });
        const afterReplacementContexts = await page.evaluate((start) => {
          const contexts = (window as Window & { __V05_WEBGL_CONTEXTS?: WebGLRenderingContext[] }).__V05_WEBGL_CONTEXTS ?? [];
          return contexts.slice(start).map((context) => context.isContextLost());
        }, contextStart);
        expect(afterReplacementContexts.filter(Boolean).length).toBeGreaterThan(0);
        expect(afterReplacementContexts.some((lost) => !lost)).toBe(true);
        await expect.poll(() => page.evaluate(() => (window as Window & { __V05_PROBE?: { lateBlobs: number } }).__V05_PROBE?.lateBlobs ?? 0), { timeout: 5000 }).toBeGreaterThan(replacementBaseline.callbacks);
        expect(await page.evaluate(() => (window as Window & { __V05_PROBE?: { latePublications: number } }).__V05_PROBE?.latePublications ?? 0)).toBe(replacementBaseline.publications);
        const replacementState = await page.evaluate(() => (window as Window & { __V05_PROBE?: { lifecycle: Array<{ renderer: boolean; camera: boolean; cleanupCount: number }> } }).__V05_PROBE!.lifecycle.at(-1));
        expect(replacementState).toMatchObject({ renderer: false, camera: false });

        await page.evaluate(() => { (window as Window & { __V05_PROBE?: { inactive: boolean } }).__V05_PROBE!.inactive = false; });
        const reopenMultipart = page.locator('.file-card').filter({ has: page.locator('.card-name[title="multipart"]') }).first();
        try { await reopenMultipart.click(); }
        catch (error) {
          await attachGridFailureEvidence(page, 'multipart-reopen', '.card-name[title="multipart"]');
          throw error;
        }
        await expect(page.locator('#viewer-loading')).toHaveClass(/hidden/, { timeout: 30000 });
        await expect.poll(() => page.evaluate(() => (window as Window & { __V05_PROBE?: { pendingBlobs: number } }).__V05_PROBE?.pendingBlobs ?? 0)).toBeGreaterThan(0);
        const closeBaseline = await page.evaluate(() => {
          const probe = (window as Window & { __V05_PROBE?: { lateBlobs: number; latePublications: number } }).__V05_PROBE!;
          return { callbacks: probe.lateBlobs, publications: probe.latePublications };
        });
        await page.evaluate(() => { (window as Window & { __V05_PROBE?: { inactive: boolean } }).__V05_PROBE!.inactive = true; });
        await page.locator('#btn-close-viewer').click();
        await expect(page.locator('#viewer-container canvas')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => (window as Window & { __V05_PROBE?: { lateBlobs: number } }).__V05_PROBE?.lateBlobs ?? 0), { timeout: 5000 }).toBeGreaterThan(closeBaseline.callbacks);
        expect(await page.evaluate(() => (window as Window & { __V05_PROBE?: { latePublications: number } }).__V05_PROBE?.latePublications ?? 0)).toBe(closeBaseline.publications);
        const lifecycle = await page.evaluate(() => (window as Window & { __V05_PROBE?: { lifecycle: Array<{ renderer: boolean; camera: boolean; cleanupCount: number }> } }).__V05_PROBE!.lifecycle);
        const activeRendererCleanupCounts = lifecycle.filter((entry) => entry.renderer).map((entry) => entry.cleanupCount);
        expect(activeRendererCleanupCounts.length).toBeGreaterThanOrEqual(2);
        expect(new Set(activeRendererCleanupCounts).size).toBe(1);
        expect(lifecycle.at(-1)).toMatchObject({ renderer: false, camera: false });
      }
      if (model === 'dense') {
        await page.locator('#btn-close-viewer').click();
        await expect(page.locator('#viewer-container canvas')).toHaveCount(0);
      }
      const contextLoss = await page.evaluate(() => {
        const contextWindow = window as Window & { __V05_WEBGL_CONTEXTS?: Array<WebGLRenderingContext | WebGL2RenderingContext> };
        return contextWindow.__V05_WEBGL_CONTEXTS?.map((context) => context.isContextLost()) ?? [];
      });
      expect(contextLoss.length).toBeGreaterThan(0);
      expect(contextLoss.every(Boolean)).toBe(true);
    }
  } finally {
    if (closeWithEvidence) await closeWithEvidence(() => isolated.close());
    else await isolated.close();
  }
});
