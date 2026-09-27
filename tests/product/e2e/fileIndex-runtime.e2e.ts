const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchIsolatedApp } = require('../../support/helpers/isolatedApp');

const APP_DIR = path.resolve(__dirname, '../../..');

function writeTinyStl(filePath) {
  fs.writeFileSync(filePath, `solid mutation-smoke
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid mutation-smoke
`);
}

async function findVisibleMainWindow(app) {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ timeout: 200 });
        return page;
      } catch {
        // Hidden thumbnail windows do not contain the main search control.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Visible main window did not become ready');
}

test('main publishes typed library mutations for scanning, annotations, and folder removal', async () => {
  let libraryRoot = '';
  let mainWindow;
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, 'out/main/index.js'),
    beforeLaunch: ({ scratchDir }) => {
      libraryRoot = path.join(scratchDir, 'library');
      fs.mkdirSync(libraryRoot);
      writeTinyStl(path.join(libraryRoot, 'mutation-smoke.stl'));
    },
  });

  try {
    mainWindow = await findVisibleMainWindow(isolated.app);
    const subscribed = await mainWindow.evaluate(() => {
      const api = window.polytray as typeof window.polytray & {
        onLibraryChanged?: (callback: (value: unknown) => void) => () => void;
      };
      if (typeof api.onLibraryChanged !== 'function') return false;
      (window as unknown as { __libraryEvents: unknown[] }).__libraryEvents = [];
      const unsubscribe = api.onLibraryChanged((value) => {
        (window as unknown as { __libraryEvents: unknown[] }).__libraryEvents.push(value);
      });
      (window as unknown as { __unsubscribeLibraryChanged?: () => void }).__unsubscribeLibraryChanged = unsubscribe;
      return true;
    });
    expect(subscribed).toBe(true);

    const scanResult = await mainWindow.evaluate(async (folderPath) => window.polytray.scanFolder(folderPath, {
      thumbnail_timeout: 20000,
      scanning_batch_size: 10,
      watcher_stability: 1000,
      page_size: 50,
      thumbnailColor: '#8888aa',
    }), libraryRoot);
    expect(scanResult.state).toBe('completed');

    const modelPath = path.join(libraryRoot, 'mutation-smoke.stl');
    const listedAfterScan = await mainWindow.evaluate(async (targetPath) => {
      const result = await window.polytray.getFiles({ limit: 20, offset: 0 });
      return result.files.find((file) => file.path === targetPath) ?? null;
    }, modelPath);
    expect(listedAfterScan).toBeTruthy();
    expect(listedAfterScan.content_revision).toBeGreaterThan(1);
    const scanEvent = await mainWindow.evaluate((targetPath) => {
      const events = (window as unknown as { __libraryEvents: Array<Record<string, unknown>> }).__libraryEvents;
      return events.find((event) => Array.isArray(event.affectedPaths)
        && event.affectedPaths.includes(targetPath)
        && event.rowsChanged === true
        && event.annotationsChanged === false) ?? null;
    }, modelPath);
    expect(scanEvent).toBeTruthy();
    expect(scanEvent.statsChanged).toBe(true);
    expect(scanEvent.topologyChanged).toBe(true);
    expect(Number.isSafeInteger(scanEvent.browseRevision)).toBe(true);

    const eventCountBeforeAnnotation = await mainWindow.evaluate(() =>
      (window as unknown as { __libraryEvents: unknown[] }).__libraryEvents.length);
    await mainWindow.evaluate(({ id }) => window.polytray.updateFileMetadata({
      id, tags: ['smoke-tag'], notes: 'smoke annotation',
    }), { id: listedAfterScan.id });
    const annotationEvent = await mainWindow.waitForFunction(({ after, targetPath }) => {
      const events = (window as unknown as { __libraryEvents: Array<Record<string, unknown>> }).__libraryEvents;
      return events.slice(after).find((event) => Array.isArray(event.affectedPaths)
        && event.affectedPaths.includes(targetPath)
        && event.annotationsChanged === true) ?? null;
    }, { after: eventCountBeforeAnnotation, targetPath: modelPath });
    const annotationPayload = await annotationEvent.jsonValue();
    // Renderer notifications coalesce scan metadata and annotation commits within the throttle window.
    // The direct annotation-only flags are covered by the repository unit test.
    expect(typeof annotationPayload.rowsChanged).toBe('boolean');
    expect(annotationPayload.annotationsChanged).toBe(true);
    expect(annotationPayload.statsChanged).toBe(false);
    expect(annotationPayload.browseRevision).toBeGreaterThan(scanEvent.browseRevision);

    const eventCountBeforeRemoval = await mainWindow.evaluate(() =>
      (window as unknown as { __libraryEvents: unknown[] }).__libraryEvents.length);
    expect(await mainWindow.evaluate((folderPath) => window.polytray.removeLibraryFolder(folderPath), libraryRoot)).toBe(true);
    const removalEvent = await mainWindow.waitForFunction(({ after, targetPath }) => {
      const events = (window as unknown as { __libraryEvents: Array<Record<string, unknown>> }).__libraryEvents;
      return events.slice(after).find((event) => Array.isArray(event.affectedPaths)
        && event.affectedPaths.includes(targetPath)
        && event.rowsChanged === true
        && event.annotationsChanged === false) ?? null;
    }, { after: eventCountBeforeRemoval, targetPath: modelPath });
    const removalPayload = await removalEvent.jsonValue();
    expect(removalPayload.statsChanged).toBe(true);
    expect(removalPayload.topologyChanged).toBe(true);
    expect(removalPayload.browseRevision).toBeGreaterThan(annotationPayload.browseRevision);

    const browseAfterRemoval = await mainWindow.evaluate(async () => window.polytray.getFiles({ limit: 20, offset: 0 }));
    expect(browseAfterRemoval.total).toBe(0);
    expect(browseAfterRemoval.files).toHaveLength(0);
  } finally {
    if (mainWindow) {
      await mainWindow.evaluate(() => (window as unknown as { __unsubscribeLibraryChanged?: () => void })
        .__unsubscribeLibraryChanged?.()).catch(() => {});
    }
    await isolated.close();
  }
});
