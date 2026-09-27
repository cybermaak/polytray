const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { launchIsolatedApp } = require("../../support/helpers/isolatedApp");

const APP_DIR = path.resolve(__dirname, "../../..");
const SIZE_CASES = [
  { name: "default", sidebarWidth: 260, previewWidth: 360 },
  { name: "minimum", sidebarWidth: 200, previewWidth: 320 },
  { name: "maximum", sidebarWidth: 600, previewWidth: 900 },
];
const WINDOW_CASES = [
  { width: 900, height: 600 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

async function findMainWindow(app) {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (const page of app.windows()) {
      try {
        await page.locator("#search-input").waitFor({ timeout: 200 });
        return page;
      } catch { /* Ignore the hidden thumbnail window. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Visible main window did not become ready");
}

test("responsive panels preserve browsing space across supported window sizes", async ({}, testInfo) => {
  test.setTimeout(240_000);
  let mainWindow;
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, "out/main/index.js"),
    beforeLaunch: ({ scratchDir }) => {
      const libraryRoot = path.join(scratchDir, "library");
      fs.mkdirSync(libraryRoot);
      const source = path.join(APP_DIR, "tests/support/fixtures/test_model_a.stl");
      for (let index = 0; index < 40; index += 1) {
        const stem = index === 39
          ? "A deliberately long model filename showing that browsing cards remain usable at minimum window size"
          : `library model ${String(index).padStart(2, "0")}`;
        fs.copyFileSync(source, path.join(libraryRoot, `${stem}.stl`));
      }
    },
  });

  try {
    mainWindow = await findMainWindow(isolated.app);
    const nativeWindow = await isolated.app.browserWindow(mainWindow);
    const libraryRoot = path.join(isolated.scratchDir, "library");
    await mainWindow.evaluate((folder) => window.polytray.scanFolder(folder, {
      thumbnail_timeout: 20000,
      scanning_batch_size: 50,
      watcher_stability: 1000,
      page_size: 500,
      thumbnailColor: "#8888aa",
    }), libraryRoot);
    await expect.poll(() => mainWindow.locator(".file-card").count(), { timeout: 30000 }).toBeGreaterThan(10);

    for (const sizeCase of SIZE_CASES) {
      for (const windowCase of WINDOW_CASES) {
        for (const lightMode of [false, true]) {
          await mainWindow.evaluate(({ size, light }) => {
            const settings = JSON.parse(localStorage.getItem("polytray-settings") || "{}");
            localStorage.setItem("polytray-settings", JSON.stringify({
              ...settings,
              sidebarWidth: size.sidebarWidth,
              previewWidth: size.previewWidth,
              lightMode: light,
            }));
          }, { size: sizeCase, light: lightMode });
          await nativeWindow.evaluate((win, size) => win.setSize(size.width, size.height), windowCase);
          await mainWindow.reload();
          await mainWindow.locator("#search-input").waitFor();
          await expect.poll(() => mainWindow.locator(".file-card").count()).toBeGreaterThan(10);

          const longNameCard = mainWindow.locator(".file-card").filter({
            has: mainWindow.locator(".card-name[title^='A deliberately long model filename']"),
          }).first();
          await mainWindow.evaluate(() => {
            const scroller = document.querySelector("[data-virtuoso-scroller]");
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
          });
          await expect(longNameCard).toBeVisible();
          await longNameCard.locator(".file-select-toggle").click();
          const scrollTopBeforePreview = await mainWindow.evaluate(() =>
            document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
          );
          await longNameCard.locator(".card-name").click();
          await expect(mainWindow.locator("#preview-panel")).not.toHaveClass(/hidden/);
          await mainWindow.waitForFunction((preferredSidebarWidth) => {
            const layout = document.querySelector("#main-layout");
            const sidebar = document.querySelector("#sidebar");
            const preview = document.querySelector("#preview-panel");
            const effectiveSidebarWidth = Math.min(
              Math.max(200, preferredSidebarWidth),
              600,
              Math.max(200, layout.clientWidth - 400),
            );
            const shouldOverlay = layout.clientWidth < effectiveSidebarWidth + 400 + 320;
            return Math.abs(sidebar.getBoundingClientRect().width - effectiveSidebarWidth) < 1
              && preview.classList.contains("overlay") === shouldOverlay;
          }, sizeCase.sidebarWidth);

          const measurements = await mainWindow.evaluate(() => {
            const layout = document.querySelector("#main-layout");
            const sidebar = document.querySelector("#sidebar");
            const content = document.querySelector("#content");
            const preview = document.querySelector("#preview-panel");
            const previewBounds = preview.getBoundingClientRect();
            const contentBounds = content.getBoundingClientRect();
            const layoutBounds = layout.getBoundingClientRect();
            const isOverlay = preview.classList.contains("overlay");
            return {
              layoutWidth: layout.clientWidth,
              sidebarWidth: sidebar.getBoundingClientRect().width,
              browseWidth: content.getBoundingClientRect().width,
              previewWidth: previewBounds.width,
              previewMode: isOverlay ? "overlay" : "docked",
              previewWithinContent: previewBounds.left >= contentBounds.left - 1
                && previewBounds.right <= (isOverlay ? contentBounds.right : layoutBounds.right) + 1,
            };
          });
          expect(measurements.browseWidth).toBeGreaterThanOrEqual(400);
          expect(measurements.previewWidth).toBeGreaterThanOrEqual(320);
          expect(measurements.previewWithinContent).toBe(true);
          expect(measurements.previewMode).toBe(
            measurements.layoutWidth < sizeCase.sidebarWidth + 400 + 320 ? "overlay" : "docked",
          );
          const persistedPreferences = await mainWindow.evaluate(() => {
            const value = JSON.parse(localStorage.getItem("polytray-settings") || "{}");
            return { sidebarWidth: value.sidebarWidth, previewWidth: value.previewWidth };
          });
          expect(persistedPreferences).toEqual({
            sidebarWidth: sizeCase.sidebarWidth,
            previewWidth: sizeCase.previewWidth,
          });

          const screenshotPath = testInfo.outputPath(
            `responsive-${windowCase.width}x${windowCase.height}-${sizeCase.name}-${lightMode ? "light" : "dark"}.png`,
          );
          await mainWindow.screenshot({ path: screenshotPath });
          await testInfo.attach(path.basename(screenshotPath), {
            path: screenshotPath,
            contentType: "image/png",
          });

          await mainWindow.locator("#btn-expand-viewer").click();
          await expect(mainWindow.locator("#preview-panel")).toHaveClass(/expanded/);
          await expect(mainWindow.locator("#preview-panel")).not.toHaveClass(/overlay/);
          await mainWindow.locator("#btn-expand-viewer").click();

          await mainWindow.locator("#btn-close-viewer").click();
          await expect(mainWindow.locator("#preview-panel")).toHaveClass(/hidden/);
          expect(await mainWindow.locator(".file-card .file-select-toggle.active").count()).toBe(1);
          expect(await mainWindow.evaluate(() =>
            document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
          )).toBe(scrollTopBeforePreview);
        }
      }
    }
  } finally {
    await isolated.close();
  }
});
