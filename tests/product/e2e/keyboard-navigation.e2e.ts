const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { launchIsolatedApp } = require("../../support/helpers/isolatedApp");

const APP_DIR = path.resolve(__dirname, "../../..");

function seedLibrary(userDataDir) {
  const seeded = spawnSync(require("electron"), [
    "--import", "tsx", path.join(APP_DIR, "tests/support/fixtures/seedLibraryPages.ts"), userDataDir,
  ], {
    cwd: APP_DIR,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (seeded.status !== 0) throw new Error(`Keyboard fixture seed failed: ${seeded.stderr}`);
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

async function tabTo(page, selector, maxTabs = 100) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await page.evaluate((targetSelector) =>
      document.activeElement instanceof Element && document.activeElement.matches(targetSelector), selector,
    ).catch(() => false)) return;
    await pressWithDeadline(page, "Tab", `tab to ${selector}`);
  }
  throw new Error(`Keyboard Tab did not reach ${selector}`);
}

async function pressWithDeadline(page, key, step) {
  let timer;
  const timedOut = await Promise.race([
    page.keyboard.press(key).then(() => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(true), 5000); }),
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) throw new Error(`Keyboard ${key} did not return within 5 seconds at: ${step}`);
}

async function applyKeyboardFixtureState(page, fixtureInfo) {
  await page.evaluate((root) => {
    const settings = JSON.parse(localStorage.getItem("polytray-settings") || "{}");
    localStorage.setItem("polytray-settings", JSON.stringify({ ...settings, autoScan: false, watch: false, page_size: 50 }));
    localStorage.setItem("polytray-library-state", JSON.stringify({ libraryFolders: [root], lastFolder: root }));
  }, fixtureInfo.libraryRoot);
  await page.reload();
  await page.locator("#search-input").waitFor();
  await expect.poll(() => page.locator("#library-result-total").innerText(), { timeout: 30000 }).not.toContain("Loading");
}

test("keyboard-only browsing preserves virtual focus and closes only the top overlay", async () => {
  test.setTimeout(60_000);
  let fixtureInfo;
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, "out/main/index.js"),
    beforeLaunch: ({ userDataDir }) => { fixtureInfo = seedLibrary(userDataDir); },
  });

  try {
    const page = await findMainWindow(isolated.app);
    await page.setViewportSize({ width: 900, height: 700 });
    await applyKeyboardFixtureState(page, fixtureInfo);

    await tabTo(page, "#btn-select-folder");
    await expect(page.locator("#btn-select-folder")).toBeFocused();
    await tabTo(page, "#btn-theme-toggle");
    await expect(page.locator("#btn-theme-toggle")).toBeFocused();
    await tabTo(page, "#btn-settings");
    await expect(page.locator("#btn-settings")).toBeFocused();
    await tabTo(page, "#file-grid [data-item-key][tabindex='0']");
    const initialFocus = page.locator("#file-grid [data-item-key][tabindex='0']");
    await expect(initialFocus).toBeFocused();
    await expect(page.locator("#file-grid .file-select-toggle:not([tabindex='-1'])")).toHaveCount(0);
    await expect(page.locator("#grid-keyboard-hint")).toContainText("Shift+Enter");
    await expect.poll(() => initialFocus.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("2px");

    const columns = await page.locator("#file-grid").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+(?![^()]*\))/).length,
    );
    const uiSort = await page.locator("#sort-select").inputValue();
    const uiDirection = await page.locator("#sort-order").evaluate((element) =>
      element.classList.contains("desc") ? "DESC" : "ASC",
    );
    const firstPage = await page.evaluate(({ sort, direction }) => window.polytray.getLibraryPage({
      sort, direction, extension: null, folder: null, search: "",
      collectionPaths: null, limit: 50, offset: 0,
    }), { sort: uiSort, direction: uiDirection });
    const orderedKeys = firstPage.status === "ok" ? firstPage.items.map((item) => item.key) : [];
    if (orderedKeys[0]?.startsWith("archive:")) {
      await expect(initialFocus).toHaveClass(/archive-summary/);
      await expect(initialFocus.locator(".file-select-toggle")).toHaveCount(0);
    }
    const fullLibrary = await page.evaluate(({ sort, direction }) => window.polytray.getLibraryPage({
      sort, direction, extension: null, folder: null, search: "",
      collectionPaths: null, limit: 200, offset: 0,
    }), { sort: uiSort, direction: uiDirection });
    const allKeys = fullLibrary.status === "ok" ? fullLibrary.items.map((item) => item.key) : [];
    const startingKey = await initialFocus.getAttribute("data-item-key");
    const startingIndex = allKeys.indexOf(startingKey);
    await pressWithDeadline(page, "ArrowDown", "move down within the grid");
    const expectedDownKey = allKeys[Math.min(startingIndex + columns, allKeys.length - 1)];
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey)).toBe(expectedDownKey);
    const downFocus = page.locator("#file-grid [data-item-key]:focus");
    await expect(downFocus).toBeFocused();
    const movedKey = await downFocus.getAttribute("data-item-key");
    const movedBy = allKeys.indexOf(movedKey);
    expect(startingIndex).toBeGreaterThanOrEqual(0);
    expect(movedBy - startingIndex).toBe(columns);

    await pressWithDeadline(page, "End", "move to the last loaded grid item");
    const lastLoadedKey = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey);
    const lastLoadedIndex = allKeys.indexOf(lastLoadedKey);
    const pageEdgeTargetKey = allKeys[Math.min(lastLoadedIndex + columns, allKeys.length - 1)];
    await pressWithDeadline(page, "ArrowDown", "cross the grid page edge");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey), { timeout: 30000 })
      .toBe(pageEdgeTargetKey);

    const previewKey = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey);
    await pressWithDeadline(page, "Enter", "open preview");
    const preview = page.getByRole("dialog", { name: "Model preview" });
    await expect(preview).toBeVisible();
    await expect(page.locator("#preview-panel")).toHaveAttribute("aria-modal", "true");
    await pressWithDeadline(page, "Shift+Tab", "contain focus in preview");
    await expect.poll(() => preview.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await pressWithDeadline(page, "Escape", "close preview");
    await expect(preview).toBeHidden();
    await expect(page.locator(`[data-item-key=${JSON.stringify(previewKey)}]`)).toBeFocused();

    // Shift+Enter starts batch selection from the single roving grid stop.
    const firstSelectedKey = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey);
    await pressWithDeadline(page, "Shift+Enter", "add the focused file to batch selection");
    await expect(page.locator("#batch-selection-count")).toHaveText("1 selected");
    await expect(page.locator("#file-grid [data-item-key]:focus")).toHaveAttribute("tabindex", "0");
    const currentIndex = allKeys.indexOf(firstSelectedKey);
    const previousPageRowKey = allKeys[Math.max(0, currentIndex - columns)];
    await pressWithDeadline(page, "ArrowUp", "move to a second file");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey)).toBe(previousPageRowKey);
    const secondSelectedKey = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey);
    expect(secondSelectedKey, "ArrowUp leaves focus on a library card").toBeTruthy();
    expect(secondSelectedKey?.startsWith("archive:")).toBe(false);
    expect(secondSelectedKey).not.toBe(firstSelectedKey);
    await page.evaluate(() => {
      (window as any).__u04Space = null;
      document.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          (window as any).__u04Space = {
            key: event.key,
            defaultPrevented: event.defaultPrevented,
            activeKey: (document.activeElement as HTMLElement).dataset.itemKey,
          };
        }
      }, { once: true });
    });
    const beforeSpace = await page.evaluate(() => ({
      key: (document.activeElement as HTMLElement).dataset.itemKey,
      role: (document.activeElement as HTMLElement).getAttribute("role"),
      selection: document.querySelector("#batch-selection-count")?.textContent,
    }));
    let spaceTimeout: ReturnType<typeof setTimeout> | undefined;
    const spaceTimedOut = await Promise.race([
      page.keyboard.press("Space").then(() => false),
      new Promise<boolean>((resolve) => { spaceTimeout = setTimeout(() => resolve(true), 5000); }),
    ]);
    if (spaceTimeout) clearTimeout(spaceTimeout);
    if (spaceTimedOut) throw new Error(`Space key press timed out with ${JSON.stringify(beforeSpace)}`);
    const afterSpace = await page.evaluate(() => ({
      event: (window as any).__u04Space,
      selection: document.querySelector("#batch-selection-count")?.textContent,
    }));
    expect(afterSpace.event).toMatchObject({ key: " ", defaultPrevented: true, activeKey: secondSelectedKey });
    expect(afterSpace.selection).toBe("2 selected");
    await expect(page.locator("#batch-selection-count")).toHaveText("2 selected");
    await expect(page.locator("#compare-selected")).toBeVisible();
    await tabTo(page, "#compare-selected");
    await pressWithDeadline(page, "Enter", "open compare");
    await expect(page.locator("#compare-panel")).toBeVisible();
    await tabTo(page, "#btn-close-compare");
    await pressWithDeadline(page, "Enter", "close compare");
    await expect(page.locator("#compare-panel")).toBeHidden();
    await expect(page.locator("#compare-selected")).toBeFocused();
    const logicalRovingKey = await page.locator("#file-grid").getAttribute("data-roving-key");
    const renderedTabStopKey = await page.locator("#file-grid").getAttribute("data-tab-stop-key");
    expect(allKeys).toContain(logicalRovingKey);
    expect(allKeys).toContain(renderedTabStopKey);
    await expect(page.locator("#file-grid [data-item-key][tabindex='0']")).toHaveCount(1);
    await expect(page.locator("#file-grid .file-select-toggle:not([tabindex='-1'])")).toHaveCount(0);
    await tabTo(page, "#file-grid [data-item-key][tabindex='0']");
    await pressWithDeadline(page, "Enter", "open preview before docking");
    await expect(page.locator("#preview-panel")).toBeVisible();
    await expect(page.locator("#preview-panel")).toHaveAttribute("aria-modal", "true");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("#preview-panel")).not.toHaveAttribute("aria-modal", "true");
    await tabTo(page, "#btn-settings");
    await pressWithDeadline(page, "Enter", "open settings over preview");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await pressWithDeadline(page, "Escape", "close settings without closing docked preview");
    await expect(page.locator("#settings-overlay")).toBeHidden();
    await expect(page.locator("#preview-panel")).toBeVisible();
    await tabTo(page, "#btn-close-viewer");
    await pressWithDeadline(page, "Enter", "close docked preview");
    await expect(page.locator("#preview-panel")).toBeHidden();

    await tabTo(page, "#library-folders [role='treeitem'][tabindex='0']");
    const focusedFolderPath = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.folderPath);
    expect(focusedFolderPath).toBeTruthy();
    const focusedFolder = page.locator(`#library-folders [role='treeitem'][data-folder-path=${JSON.stringify(focusedFolderPath)}]`);
    await pressWithDeadline(page, "ArrowRight", "expand focused folder");
    await expect(focusedFolder).toHaveAttribute("aria-expanded", "true");
    await expect(focusedFolder).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.folderPath), { timeout: 5000 })
      .toBe(focusedFolderPath);
    await expect(focusedFolder).toBeFocused();
    const childGroup = focusedFolder.locator(":scope > [role='group']");
    await expect(childGroup).toBeVisible();
    const childFolder = childGroup.getByRole("treeitem").first();
    await expect(childFolder).toBeVisible();
    await pressWithDeadline(page, "ArrowDown", "focus child folder");
    await expect(childFolder).toBeFocused();
    await expect(childFolder).toHaveAttribute("tabindex", "0");
    await pressWithDeadline(page, "Enter", "select child folder");
    await expect(childFolder).toHaveAttribute("aria-selected", "true");
    await expect(childFolder).toBeFocused();

    await tabTo(page, "#btn-settings");
    await pressWithDeadline(page, "Enter", "open settings");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(page.locator("#settings-close")).toBeFocused();
    await pressWithDeadline(page, "Escape", "close settings");
    await expect(settings).toBeHidden();
    await expect(page.locator("#btn-settings")).toBeFocused();

    const libraryRootTreeItem = page.locator("#library-folders [role='treeitem'][aria-keyshortcuts='Delete']");
    await expect(libraryRootTreeItem).toHaveAttribute("aria-describedby", "library-folder-delete-hint");
    await expect(libraryRootTreeItem.locator(".library-folder-remove")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("#library-folders .library-folder-remove:not([tabindex='-1'])")).toHaveCount(0);
    await tabTo(page, "#library-folders [role='treeitem'][tabindex='0']");
    await pressWithDeadline(page, "ArrowLeft", "return to library root treeitem");
    await expect(libraryRootTreeItem).toBeFocused();
    await pressWithDeadline(page, "Delete", "remove library root through its treeitem action");
    await expect.poll(() => page.evaluate((root) => {
      const state = JSON.parse(localStorage.getItem("polytray-library-state") || "{}");
      return state.libraryFolders?.includes(root) ?? false;
    }, fixtureInfo.libraryRoot)).toBe(false);

    await expect(page.locator(".file-card.archive-summary .file-select-toggle")).toHaveCount(0);
  } finally {
    await isolated.close();
  }
});

test("ArrowDown across a loaded page edge preserves the focused column", async () => {
  test.setTimeout(30_000);
  let fixtureInfo;
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, "out/main/index.js"),
    beforeLaunch: ({ userDataDir }) => { fixtureInfo = seedLibrary(userDataDir); },
  });
  try {
    const page = await findMainWindow(isolated.app);
    await page.setViewportSize({ width: 900, height: 700 });
    await applyKeyboardFixtureState(page, fixtureInfo);
    await tabTo(page, "#file-grid [data-item-key][tabindex='0']");
    const uiSort = await page.locator("#sort-select").inputValue();
    const uiDirection = await page.locator("#sort-order").evaluate((element) =>
      element.classList.contains("desc") ? "DESC" : "ASC",
    );
    const result = await page.evaluate(({ sort, direction }) => window.polytray.getLibraryPage({
      sort, direction, extension: null, folder: null, search: "",
      collectionPaths: null, limit: 200, offset: 0,
    }), { sort: uiSort, direction: uiDirection });
    const keys = result.status === "ok" ? result.items.map((item) => item.key) : [];
    const columns = await page.locator("#file-grid").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+(?![^()]*\))/).length,
    );
    const initialKey = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey);
    await pressWithDeadline(page, "End", "move to the last loaded grid item");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey), { timeout: 5000 })
      .not.toBe(initialKey);
    const lastLoadedKey = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey);
    const lastLoadedIndex = keys.indexOf(lastLoadedKey);
    const expected = keys[Math.min(lastLoadedIndex + columns, keys.length - 1)];
    await pressWithDeadline(page, "ArrowDown", "cross the grid page edge");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.itemKey), { timeout: 5000 })
      .toBe(expected);
  } finally {
    await isolated.close();
  }
});

test("Delete on a focused library root uses the tree action without a per-item Tab stop", async () => {
  test.setTimeout(30_000);
  let fixtureInfo;
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, "out/main/index.js"),
    beforeLaunch: ({ userDataDir }) => { fixtureInfo = seedLibrary(userDataDir); },
  });
  try {
    const page = await findMainWindow(isolated.app);
    await applyKeyboardFixtureState(page, fixtureInfo);
    const rootTreeItem = page.locator("#library-folders [role='treeitem'][aria-keyshortcuts='Delete']");
    await tabTo(page, "#library-folders [role='treeitem'][aria-keyshortcuts='Delete']");
    await expect(rootTreeItem).toBeFocused();
    await expect(rootTreeItem).toHaveAttribute("aria-describedby", "library-folder-delete-hint");
    await expect(rootTreeItem.locator(".library-folder-remove")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("#library-folders .library-folder-remove:not([tabindex='-1'])")).toHaveCount(0);
    await pressWithDeadline(page, "Delete", "remove library root through its treeitem action");
    await expect.poll(() => page.evaluate((root) => {
      const state = JSON.parse(localStorage.getItem("polytray-library-state") || "{}");
      return state.libraryFolders?.includes(root) ?? false;
    }, fixtureInfo.libraryRoot)).toBe(false);
  } finally {
    await isolated.close();
  }
});
