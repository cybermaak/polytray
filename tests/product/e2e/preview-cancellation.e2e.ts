const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { launchIsolatedApp } = require('../../support/helpers/isolatedApp');
const { attachJsonFailureEvidence } = require('../../support/helpers/failureEvidence');
const JSZip = require('jszip');

const APP_DIR = path.resolve(__dirname, '../../..');
const SETTINGS = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 10,
  watcher_stability: 1000,
  page_size: 50,
  thumbnailColor: '#8888aa',
};

function writeTinyStl(filePath) {
  fs.writeFileSync(filePath, `solid preview-parallel
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid preview-parallel
`);
}

async function writeFallback3mf(filePath) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`);
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <colorgroup id="2"><color color="#FF0000"/></colorgroup>
    <object id="1" type="model" pid="2" pindex="0"><mesh>
      <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices>
      <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
    </mesh></object>
  </resources>
  <build><item objectid="1"/></build>
</model>`);
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function findMainWindow(app) {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ timeout: 200 });
        return page;
      } catch { /* Other windows are hidden preview/thumbnail renderers. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Main window did not become ready');
}

function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

async function closeIsolatedApp(isolated) {
  let timeout;
  const closed = await Promise.race([
    isolated.close().then(() => true),
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5000); }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (closed) return;

  // A deliberately busy test renderer must not leave this isolated Electron app behind on failure.
  const appProcess = isolated.app.process();
  appProcess.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (appProcess.exitCode === null) appProcess.kill('SIGKILL');
  fs.rmSync(path.dirname(isolated.userDataDir), { recursive: true, force: true });
}

test('held 3MF parsing is cancelled by latest request without stopping main or thumbnail work', async () => {
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, 'out/main/index.js'),
    env: { POLYTRAY_PREVIEW_TEST_HOLD_MS: '8000' },
    beforeLaunch: async ({ scratchDir }) => {
      const library = path.join(scratchDir, 'library');
      fs.mkdirSync(library);
      await writeFallback3mf(path.join(library, 'fallback.3mf'));
      writeTinyStl(path.join(library, 'thumbnail.stl'));
    },
  });

  let mainWindow;
  try {
    const appProcess = isolated.app.process();
    let mainOutput = '';
    appProcess.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      mainOutput += text;
      console.error(`[preview-e2e main] ${text}`);
    });
    appProcess.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      mainOutput += text;
      console.log(`[preview-e2e main] ${text}`);
    });
    mainWindow = await findMainWindow(isolated.app);
    await mainWindow.evaluate(({ folder, settings }) => window.polytray.scanFolder(folder, settings), {
      folder: path.join(isolated.scratchDir, 'library'), settings: SETTINGS,
    });
    const indexed = await mainWindow.evaluate(async (folder) => {
      const result = await window.polytray.getFiles({ folder, limit: 20, offset: 0 });
      return result.files;
    }, path.join(isolated.scratchDir, 'library'));
    const model = indexed.find((row) => row.extension === '3mf');
    const thumbnailModel = indexed.find((row) => row.extension === 'stl');
    expect(model).toBeTruthy();
    expect(thumbnailModel).toBeTruthy();

    const mainNative = await isolated.app.browserWindow(mainWindow);
    const mainPid = await mainNative.evaluate((win) => win.webContents.getOSProcessId());
    const previewConsole = [];
    isolated.app.on('window', (page) => {
      page.on('console', (message) => {
        previewConsole.push(message.text());
        for (const argument of message.args()) {
          void argument.jsonValue().then((value) => {
            previewConsole.push(typeof value === 'string' ? value : JSON.stringify(value));
          }).catch(() => {});
        }
      });
    });

    const request = (requestId) => ({
      requestId, path: model.path, extension: model.extension, contentRevision: model.content_revision,
    });
    await mainWindow.evaluate((req) => {
      const state = window as unknown as { __previewSettlements?: Record<string, string> };
      state.__previewSettlements = {};
      void window.polytray.requestPreviewParse(req).then(
        () => { state.__previewSettlements![req.requestId] = 'resolved'; },
        () => { state.__previewSettlements![req.requestId] = 'rejected'; },
      );
    }, request('preview-A'));

    await expect.poll(() => mainOutput.includes('__preview_test_hold__preview-A'), { timeout: 10000 })
      .toBe(true);
    console.log('[preview-e2e] confirmed A is in the held parser');
    const heldPage = isolated.app.windows().find((page) => page.url().includes('preview.html'));
    expect(heldPage).toBeTruthy();
    const heldNative = await isolated.app.browserWindow(heldPage);
    console.log('[preview-e2e] obtained owned BrowserWindow handle');
    const heldPid = await heldNative.evaluate((win) => win.webContents.getOSProcessId());
    console.log('[preview-e2e] read held renderer PID', heldPid);
    expect(heldPid).toBeGreaterThan(0);
    expect(heldPid).not.toBe(mainPid);

    const thumbnailPage = isolated.app.windows().find((page) => page.url().includes('thumbnail.html'));
    expect(thumbnailPage, 'the independent thumbnail renderer is initialized').toBeTruthy();
    const thumbnailNative = await isolated.app.browserWindow(thumbnailPage);
    const thumbnailPid = await thumbnailNative.evaluate((win) => win.webContents.getOSProcessId());
    expect(thumbnailPid).toBeGreaterThan(0);
    expect(thumbnailPid).not.toBe(mainPid);
    expect(thumbnailPid).not.toBe(heldPid);

    const thumbnailResult = await mainWindow.evaluate(async ({ filePath, extension, settings }) =>
      window.polytray.requestThumbnailGeneration(filePath, extension, settings), {
      filePath: thumbnailModel.path, extension: thumbnailModel.extension, settings: SETTINGS,
    });
    console.log('[preview-e2e] thumbnail work completed');
    expect(thumbnailResult).toBeTruthy();
    expect(fs.existsSync(thumbnailResult)).toBe(true);
    expect(pidIsAlive(heldPid), 'held preview process remains alive until replacement').toBe(true);

    const replacementStartedAt = Date.now();
    console.log('[preview-e2e] sending B and C');
    let replacementDispatchFinished = false;
    let replacementDispatchError;
    const replacementDispatch = mainWindow.evaluate((reqs) => {
      const state = window as unknown as { __previewSettlements: Record<string, string> };
      for (const req of reqs) {
        void window.polytray.requestPreviewParse(req).then(
          () => { state.__previewSettlements[req.requestId] = 'resolved'; },
          () => { state.__previewSettlements[req.requestId] = 'rejected'; },
        );
      }
    }, [request('preview-B'), request('preview-C')]).then(
      () => { replacementDispatchFinished = true; },
      (error) => { replacementDispatchFinished = true; replacementDispatchError = error; },
    );

    let stoppedInMs = 0;
    try {
      await expect.poll(() => pidIsAlive(heldPid), { timeout: 1500, intervals: [20, 50, 100] }).toBe(false);
      stoppedInMs = Date.now() - replacementStartedAt;
      console.log('[preview-e2e] old renderer stopped', stoppedInMs);
      expect(stoppedInMs, 'obsolete renderer is stopped within the C10 replacement budget').toBeLessThanOrEqual(500);
    } catch (error) {
      await attachJsonFailureEvidence('preview-old-pid-state', async () => {
        const procStatPath = `/proc/${heldPid}/stat`;
        let procStat = null;
        if (process.platform === 'linux') {
          try { procStat = fs.readFileSync(procStatPath, 'utf8'); }
          catch { /* The PID may have exited during the diagnostic. */ }
        }
        const command = process.platform === 'win32' ? null
          : spawnSync('ps', ['-o', 'pid,ppid,stat,command', '-p', String(heldPid)], {
            encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024,
          }).stdout;
        return {
          heldPid, mainPid, thumbnailPid,
          aliveBySignalZero: pidIsAlive(heldPid),
          linuxProcessState: procStat?.slice(procStat.lastIndexOf(')') + 2).split(' ')[0] ?? null,
          processListing: command,
          replacementElapsedMs: Date.now() - replacementStartedAt,
          replacementDispatchFinished,
          replacementDispatchError: replacementDispatchError ? String(replacementDispatchError) : null,
          windows: await Promise.all(isolated.app.windows().map(async candidate => {
            const url = candidate.url();
            try {
              const owner = await isolated.app.browserWindow(candidate);
              return { url, pid: await owner.evaluate(win => win.webContents.getOSProcessId()) };
            } catch (cause) { return { url, error: String(cause) }; }
          })),
          bridge: await mainWindow.evaluate(() => window.polytray.__previewParsePendingCounts?.()),
        };
      });
      throw error;
    }
    await expect.poll(() => replacementDispatchFinished, { timeout: 5000 }).toBe(true);
    expect(replacementDispatchError).toBeUndefined();
    await replacementDispatch;
    expect(pidIsAlive(mainPid)).toBe(true);
    expect(pidIsAlive(thumbnailPid)).toBe(true);
    expect(await thumbnailNative.evaluate((win) => win.webContents.getOSProcessId())).toBe(thumbnailPid);
    expect(await mainWindow.evaluate(() => document.querySelector('#search-input')?.isConnected)).toBe(true);

    await expect.poll(() => mainWindow.evaluate(() => {
      const values = (window as unknown as { __previewSettlements: Record<string, string> }).__previewSettlements;
      return values['preview-C'];
    }), { timeout: 15000 }).toBe('resolved');
    const settlements = await mainWindow.evaluate(() =>
      (window as unknown as { __previewSettlements: Record<string, string> }).__previewSettlements);
    expect(settlements['preview-A']).toBe('rejected');
    expect(settlements['preview-B']).toBe('rejected');
    expect(settlements['preview-C']).toBe('resolved');
    const requesterCounts = await mainWindow.evaluate(() => window.polytray.__previewParsePendingCounts?.());
    expect(requesterCounts).toEqual({ parses: 0, archiveReads: 0, hiddenPorts: 0, hiddenParseListeners: 0 });
    const replacementPage = isolated.app.windows().find((page) => page.url().includes('preview.html'));
    expect(replacementPage).toBeTruthy();
    const runtimeCounts = await replacementPage.evaluate(() => window.polytray.__previewParsePendingCounts?.());
    expect(runtimeCounts).toEqual({ parses: 0, archiveReads: 0, hiddenPorts: 0, hiddenParseListeners: 1 });
    console.log(JSON.stringify({
      previewPid: heldPid,
      replacementStopMs: stoppedInMs,
      mainPid,
      thumbnailPid,
      thumbnailOutput: thumbnailResult,
      settlements,
    }));

    await expect.poll(() => previewConsole.some((line) => line.includes('fast-3mf-fallback'))).toBe(true);
    expect(isolated.app.windows().some((page) => page.url().includes('preview.html')),
      'the successful replacement leaves a current preview runtime').toBe(true);
    expect(pidIsAlive(mainPid)).toBe(true);
    expect(pidIsAlive(thumbnailPid)).toBe(true);
  } finally {
    await closeIsolatedApp(isolated);
  }
});
