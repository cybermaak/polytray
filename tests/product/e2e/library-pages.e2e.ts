const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { launchIsolatedApp } = require("../../support/helpers/isolatedApp");
const { attachGridFailureEvidence } = require("../../support/helpers/gridFailureEvidence");

const APP_DIR = path.resolve(__dirname, "../../..");

function seedLibrary(userDataDir) {
  const seeded = spawnSync(require("electron"), [
    "--import", "tsx", path.join(APP_DIR, "tests/support/fixtures/seedLibraryPages.ts"), userDataDir,
  ], {
    cwd: APP_DIR,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (seeded.status !== 0) throw new Error(`Page fixture seed failed: ${seeded.stderr}`);
  return JSON.parse(seeded.stdout.trim());
}

async function findMainWindow(app) {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (const page of app.windows()) {
      try {
        await page.locator("#search-input").waitFor({ timeout: 200 });
        return page;
      } catch { /* Skip hidden thumbnail windows. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Visible main window did not become ready");
}

async function applyLibraryState(page, libraryRoot, collections, activeCollectionId) {
  await page.evaluate(({ root, collectionState, activeId }) => {
    const settings = JSON.parse(localStorage.getItem("polytray-settings") || "{}");
    localStorage.setItem("polytray-settings", JSON.stringify({ ...settings, autoScan: false, watch: false, page_size: 500 }));
    localStorage.setItem("polytray-library-state", JSON.stringify({ libraryFolders: [root], lastFolder: root }));
    localStorage.setItem("polytray-collections", JSON.stringify({ collections: collectionState, activeCollectionId: activeId }));
  }, { root: libraryRoot, collectionState: collections, activeId: activeCollectionId });
  await page.reload();
  await page.locator("#search-input").waitFor();
}

test("library pages expose every matching model, complete archive counts, and stable selection", async () => {
  test.setTimeout(180_000);
  let fixtureInfo;
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, "out/main/index.js"),
    beforeLaunch: ({ userDataDir }) => { fixtureInfo = seedLibrary(userDataDir); },
  });

  try {
    const page = await findMainWindow(isolated.app);
    const fullCollection = { id: "all-600", name: "All 600", filePaths: fixtureInfo.collectionPaths };
    const lastCollection = { id: "last-only", name: "Last record", filePaths: [fixtureInfo.lastRecordPath] };
    const emptyCollection = { id: "empty", name: "Empty", filePaths: [] };
    const collections = [fullCollection, lastCollection, emptyCollection];

    await applyLibraryState(page, fixtureInfo.libraryRoot, collections, fullCollection.id);
    await expect.poll(() => page.locator("#library-result-total").innerText(), { timeout: 30000 }).toContain("600 models");

    const query = {
      sort: "name", direction: "ASC", extension: null, folder: null, search: "",
      collectionPaths: fixtureInfo.collectionPaths, limit: 500, offset: 0,
    };
    const firstPage = await page.evaluate((value) => window.polytray.getLibraryPage(value), query);
    expect(firstPage.status).toBe("ok");
    expect(firstPage.totalItems).toBe(600);
    expect(firstPage.totalModels).toBe(600);
    expect(firstPage.nextOffset).toBe(500);

    const secondPage = await page.evaluate((value) => window.polytray.getLibraryPage(value), {
      ...query, offset: firstPage.nextOffset, expectedBrowseRevision: firstPage.revision,
    });
    expect(secondPage.status).toBe("ok");
    expect(firstPage.items[499].file.name).toBe("member-00498.stl");
    expect(secondPage.items[0].file.name).toBe("member-00498.stl");
    expect(firstPage.items[499].key.localeCompare(secondPage.items[0].key, "en")).toBeLessThan(0);

    const firstFile = firstPage.items[0].file;
    await page.locator(`.file-card[data-file-id="${firstFile.id}"] .file-select-toggle`).click();
    const lastRecordCard = page.locator(`.file-card[data-file-id="${fixtureInfo.thumbnailTestFileId}"]`);
    const lastRecordName = page.locator(`.card-name[title="${fixtureInfo.lastRecordName}"]`);
    try {
      const scroller = page.locator('[data-virtuoso-scroller]');
      await scroller.hover();
      const firstPageHeight = await scroller.evaluate((element) => element.scrollHeight);
      await page.mouse.wheel(0, firstPageHeight);
      const pageOneLastCard = page.locator(`[data-item-key="${firstPage.items[499].key}"]`);
      let navigationState = 'waiting';
      await expect.poll(async () => {
        if (await lastRecordCard.count()) return navigationState = 'target';
        if (await pageOneLastCard.count()) {
          return navigationState = await page.locator('.library-page-footer').count() ? 'edge' : 'loaded';
        }
        return navigationState;
      }, { timeout: 15_000 }).not.toBe('waiting');
      if (navigationState === 'edge') {
        await pageOneLastCard.focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator(`[data-item-key="${secondPage.items[0].key}"]`)).toBeVisible({ timeout: 15_000 });
      }
      if (navigationState !== 'target') {
        const fullHeight = await scroller.evaluate((element) => element.scrollHeight);
        await page.mouse.wheel(0, fullHeight);
      }
      await expect(lastRecordCard).toBeVisible({ timeout: 30_000 });
    } catch (error) {
      await attachGridFailureEvidence(page, 'library-tail', `.file-card[data-file-id="${fixtureInfo.thumbnailTestFileId}"]`);
      throw error;
    }
    await expect(lastRecordName).toBeVisible();
    const loadedThumbnail = lastRecordCard.locator("img[data-thumbnail-state]");
    await expect(loadedThumbnail).toHaveAttribute("data-thumbnail-state", "placeholder");
    await page.evaluate((folder) => window.polytray.scanFolder(folder, {
      thumbnail_timeout: 20000,
      scanning_batch_size: 50,
      watcher_stability: 1000,
      page_size: 500,
      thumbnailColor: "#8888aa",
    }), fixtureInfo.thumbnailTestFolder);
    await expect(loadedThumbnail).toHaveAttribute("data-thumbnail-state", "ready", { timeout: 30000 });
    const scrollBeforeThumbnailClear = await page.locator("[data-virtuoso-scroller]").evaluate((element) => element.scrollTop);
    await page.evaluate(() => window.polytray.clearThumbnails({
      thumbnail_timeout: 20000,
      scanning_batch_size: 50,
      watcher_stability: 1000,
      page_size: 500,
      thumbnailColor: "#8888aa",
    }));
    await expect(loadedThumbnail).toHaveAttribute("data-thumbnail-state", "placeholder", { timeout: 30000 });
    await expect.poll(() => page.locator("[data-virtuoso-scroller]").evaluate((element) => element.scrollTop))
      .toBe(scrollBeforeThumbnailClear);
    await expect(page.locator("#batch-selection-count")).toHaveText("1 selected");
    await expect(page.locator("#library-result-total")).toContainText("600 models");
    await expect(page.locator("#batch-selection-count")).toHaveText("1 selected");
    await page.locator("#batch-tags-input").fill("page-one-retained");
    await page.locator("#apply-batch-tags").click();
    await expect.poll(async () => {
      const current = await page.evaluate((id) => window.polytray.getFileById(id), firstFile.id);
      return JSON.parse(current.tags || "[]");
    }).toContain("page-one-retained");

    await page.locator("#search-input").fill("no-matching-model");
    await expect.poll(() => page.locator("#library-result-total").innerText(), { timeout: 10000 }).toContain("0 models");
    await expect(page.locator("#batch-actions")).toHaveCount(0);

    await applyLibraryState(page, fixtureInfo.libraryRoot, collections, emptyCollection.id);
    await expect.poll(() => page.locator("#library-result-total").innerText(), { timeout: 30000 }).toContain("0 models");
    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator(".file-card")).toHaveCount(0);

    await applyLibraryState(page, fixtureInfo.libraryRoot, collections, lastCollection.id);
    await expect.poll(() => page.locator("#library-result-total").innerText(), { timeout: 30000 }).toContain("1 model");
    await expect(page.locator(`.card-name[title="${fixtureInfo.lastRecordName}"]`)).toBeVisible();
    await expect(page.locator(".file-card")).toHaveCount(1);

    await applyLibraryState(page, fixtureInfo.libraryRoot, collections, null);
    await expect.poll(() => page.locator("#library-result-total").innerText(), { timeout: 30000 }).toContain("81 items / 600 models");
    await expect(page.locator(".card-name[title=" + JSON.stringify(path.basename(fixtureInfo.archivePath)) + "]")).toBeVisible();
    const grouped = await page.evaluate((value) => window.polytray.getLibraryPage(value), {
      sort: "name", direction: "ASC", extension: null, folder: null, search: "",
      collectionPaths: null, limit: 500, offset: 0,
    });
    expect(grouped.totalModels).toBe(600);
    expect(grouped.totalItems).toBe(81);
    const archive = grouped.items.find((item) => item.kind === "archive");
    expect(archive.modelCount).toBe(520);
    expect(archive.thumbnailSamples.length).toBeLessThanOrEqual(4);
    await expect(page.locator(".file-card.archive-summary .card-source-badge")).toContainText("520 models");

    const archiveQuery = {
      sort: "name", direction: "ASC", extension: null,
      folder: null, search: "", collectionPaths: null, archivePath: fixtureInfo.archivePath,
      limit: 500, offset: 0,
    };
    const archivePage = await page.evaluate((value) => window.polytray.getLibraryPage(value), archiveQuery);
    expect(archivePage.status).toBe("ok");
    expect(archivePage.totalItems).toBe(520);
    expect(archivePage.nextOffset).toBe(500);
    const archiveTail = await page.evaluate((value) => window.polytray.getLibraryPage(value), {
      ...archiveQuery, offset: 500, expectedBrowseRevision: archivePage.revision,
    });
    expect(archiveTail.status).toBe("ok");
    expect(archiveTail.items).toHaveLength(20);
  } finally {
    await isolated.close();
  }
});
