const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const electronBinary = require('electron');
const { launchIsolatedApp } = require('../../support/helpers/isolatedApp');

const APP_DIR = path.resolve(__dirname, '../../..');

function runElectronNode(scriptPath, args) {
  const result = spawnSync(electronBinary, ['--import', 'tsx', path.resolve(APP_DIR, scriptPath), ...args], {
    cwd: APP_DIR,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (result.status !== 0) throw new Error(`Electron Node helper failed (${scriptPath}): ${result.stderr}`);
  return result.stdout.trim();
}

async function findMainWindow(app) {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ state: 'attached', timeout: 200 });
        return page;
      } catch {
        // Skip the detached thumbnail renderer.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Visible main window did not become ready');
}

test('startup keeps legacy file cards visible while the scope index is backfilling', async () => {
  let releasePath = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, 'out/main/index.js'),
    env: { POLYTRAY_SCOPE_BACKFILL_TEST_HOLD: '1' },
    beforeLaunch: ({ userDataDir, scratchDir }) => {
      runElectronNode('tests/dev/seed-performance-database.ts', [
        '600', userDataDir, 'grouped', 'incomplete',
      ]);
      releasePath = path.join(scratchDir, 'scope-backfill-release');
    },
  });

  try {
    const window = await findMainWindow(isolated.app);
    const reachedPath = path.join(isolated.scratchDir, 'scope-backfill-reached');
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 30_000 }).toBe(true);

    const scopeState = JSON.parse(runElectronNode('tests/dev/read-scope-index-state.ts', [isolated.userDataDir]));
    expect(scopeState.complete).toBe(false);
    expect(scopeState.fileCount).toBe(600);
    expect(scopeState.scopeRowCount).toBeGreaterThan(0);

    await expect(window.locator('.file-card .card-name').first()).toBeVisible({ timeout: 1_000 });
    const requests = await isolated.app.evaluate(() => {
      const counts = globalThis.__POLYTRAY_ISOLATED_REQUEST_COUNTS;
      return counts?.libraryPages ?? 0;
    });
    expect(requests).toBeGreaterThan(0);

    const path0 = path.join(isolated.userDataDir, 'library', 'folder-00', 'model-000000.stl');
    const path599 = path.join(isolated.userDataDir, 'library', 'folder-39', 'model-000599.3mf');
    await window.evaluate(({ storageKey, paths }) => {
      localStorage.setItem(storageKey, JSON.stringify({
        activeCollectionId: 'startup-collection',
        collections: [{ id: 'startup-collection', name: 'Startup collection', filePaths: paths }],
      }));
    }, { storageKey: 'polytray-collections', paths: [path0, path599] });
    await window.reload();
    await window.locator('#search-input').waitFor({ state: 'attached' });
    const stillBackfilling = JSON.parse(runElectronNode('tests/dev/read-scope-index-state.ts', [isolated.userDataDir]));
    expect(stillBackfilling.complete).toBe(false);
    await expect(window.locator('.file-card')).toHaveCount(0);
    await expect(window.locator('#toolbar .context-chip').filter({ hasText: 'results' })).toHaveText('Loading results…');

    fs.writeFileSync(releasePath, 'release');
    const collectionPage = await window.evaluate((paths) => window.polytray.getLibraryPage({
      sort: 'name', direction: 'ASC', extension: null, folder: null,
      search: '', collectionPaths: paths, limit: 50, offset: 0,
    }), [path0, path599]);
    expect(collectionPage.status).toBe('ok');
    expect(collectionPage.totalModels).toBe(2);
    expect(collectionPage.totalItems).toBe(2);
    await expect(window.locator('.file-card .card-name[title="model-000000.stl"]')).toBeVisible();
    await expect(window.locator('.file-card .card-name[title="model-000599.3mf"]')).toBeVisible();

    const allDisplayKeys = await window.evaluate(async () => {
      const keys: string[] = [];
      let offset = 0;
      let totalItems = 0;
      do {
        const page = await window.polytray.getLibraryPage({
          sort: 'name', direction: 'ASC', extension: null, folder: null,
          search: '', collectionPaths: null, limit: 50, offset,
        });
        if (page.status !== 'ok') throw new Error(`Unexpected page status: ${page.status}`);
        totalItems = page.totalItems;
        keys.push(...page.items.map((item) => item.key));
        offset = page.nextOffset ?? -1;
      } while (offset >= 0);
      return { totalItems, keys };
    });
    expect(allDisplayKeys.keys).toHaveLength(allDisplayKeys.totalItems);
    expect(new Set(allDisplayKeys.keys).size).toBe(allDisplayKeys.totalItems);
  } finally {
    if (releasePath) fs.writeFileSync(releasePath, 'release');
    await isolated.close();
  }
});
