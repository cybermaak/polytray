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
    const measurementsByCase = [];
    const libraryRoot = path.join(isolated.scratchDir, "library");
    await mainWindow.evaluate((folder) => window.polytray.scanFolder(folder, {
      thumbnail_timeout: 20000,
      scanning_batch_size: 50,
      watcher_stability: 1000,
      page_size: 500,
      thumbnailColor: "#8888aa",
    }), libraryRoot);
    await expect.poll(() => mainWindow.evaluate(async () =>
      (await window.polytray.getFiles({ limit: 500, offset: 0 })).total,
    ), { timeout: 30000 }).toBeGreaterThanOrEqual(40);
    await expect(mainWindow.locator("#scan-progress")).toHaveClass(/hidden/, { timeout: 30000 });
    await expect.poll(() => mainWindow.evaluate(async () => {
      const result = await window.polytray.getFiles({ limit: 500, offset: 0 });
      return result.files.filter((file) => file.thumbnail || file.thumbnail_failed).length;
    }), { timeout: 60000 }).toBeGreaterThanOrEqual(40);
    await mainWindow.evaluate((folder) => {
      localStorage.setItem("polytray-library-state", JSON.stringify({
        libraryFolders: [folder],
        lastFolder: folder,
      }));
    }, libraryRoot);

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
              autoScan: false,
            }));
          }, { size: sizeCase, light: lightMode });
          await nativeWindow.evaluate((win, size) => win.setSize(size.width, size.height), windowCase);
          await mainWindow.reload();
          await mainWindow.locator("#search-input").waitFor();
          await expect.poll(() => mainWindow.evaluate(async () =>
            (await window.polytray.getFiles({ limit: 500, offset: 0 })).total,
          ), { timeout: 30000 }).toBeGreaterThanOrEqual(40);

          const longNameCard = mainWindow.locator(".file-card").filter({
            has: mainWindow.locator(".card-name[title^='A deliberately long model filename']"),
          }).first();
          await expect(longNameCard).toBeVisible();
          await longNameCard.locator(".card-name").click();
          await expect(mainWindow.locator("#preview-panel")).not.toHaveClass(/hidden/);
          await expect(mainWindow.locator("#viewer-loading")).toHaveClass(/hidden/, { timeout: 30000 });
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
          measurementsByCase.push({
            window: windowCase,
            savedWidths: sizeCase,
            theme: lightMode ? "light" : "dark",
            effectiveWidths: {
              sidebar: measurements.sidebarWidth,
              browse: measurements.browseWidth,
              preview: measurements.previewWidth,
            },
            previewMode: measurements.previewMode,
            persistedPreferences,
          });

          const screenshotPath = testInfo.outputPath(
            `responsive-${windowCase.width}x${windowCase.height}-${sizeCase.name}-${lightMode ? "light" : "dark"}.png`,
          );
          await mainWindow.screenshot({ path: screenshotPath });
          await testInfo.attach(path.basename(screenshotPath), {
            path: screenshotPath,
            contentType: "image/png",
          });

          if (sizeCase.name === "maximum" && windowCase.width === 900 && !lightMode) {
            const sidebarBeforeDrag = measurements.sidebarWidth;
            await mainWindow.evaluate(() => {
              const probe = window as Window & { __previewColorEvents: number };
              probe.__previewColorEvents = 0;
              window.addEventListener("polytray-preview-color", () => { probe.__previewColorEvents += 1; });
            });
            const sidebarHandle = await mainWindow.locator(".sidebar-resize-handle").boundingBox();
            await mainWindow.mouse.move(sidebarHandle.x + sidebarHandle.width / 2, sidebarHandle.y + sidebarHandle.height / 2);
            await mainWindow.mouse.down();
            await mainWindow.mouse.up();
            expect(await mainWindow.evaluate(() => {
              const value = JSON.parse(localStorage.getItem("polytray-settings") || "{}");
              return { sidebarWidth: value.sidebarWidth, previewWidth: value.previewWidth };
            })).toEqual({ sidebarWidth: 600, previewWidth: 900 });
            await mainWindow.mouse.move(sidebarHandle.x + sidebarHandle.width / 2, sidebarHandle.y + sidebarHandle.height / 2);
            await mainWindow.mouse.down();
            await mainWindow.mouse.move(sidebarHandle.x + sidebarHandle.width / 2 - 12, sidebarHandle.y + sidebarHandle.height / 2);
            await mainWindow.mouse.up();
            await expect.poll(() => mainWindow.locator("#sidebar").evaluate((element) => element.getBoundingClientRect().width))
              .toBe(sidebarBeforeDrag - 12);

            const previewBeforeDrag = await mainWindow.locator("#preview-panel").evaluate((element) => element.getBoundingClientRect().width);
            const previewHandle = await mainWindow.locator(".preview-resize-handle").boundingBox();
            await mainWindow.mouse.move(previewHandle.x + previewHandle.width / 2, previewHandle.y + previewHandle.height / 2);
            await mainWindow.mouse.down();
            await mainWindow.mouse.up();
            expect(await mainWindow.evaluate(() => {
              const value = JSON.parse(localStorage.getItem("polytray-settings") || "{}");
              return { sidebarWidth: value.sidebarWidth, previewWidth: value.previewWidth };
            })).toEqual({ sidebarWidth: sidebarBeforeDrag - 12, previewWidth: 900 });
            await mainWindow.mouse.move(previewHandle.x + previewHandle.width / 2, previewHandle.y + previewHandle.height / 2);
            await mainWindow.mouse.down();
            await mainWindow.mouse.move(previewHandle.x + previewHandle.width / 2 + 12, previewHandle.y + previewHandle.height / 2);
            await mainWindow.mouse.up();
            await expect.poll(() => mainWindow.locator("#preview-panel").evaluate((element) => element.getBoundingClientRect().width))
              .toBe(previewBeforeDrag - 12);

            const resizedPreferences = await mainWindow.evaluate(() => {
              const value = JSON.parse(localStorage.getItem("polytray-settings") || "{}");
              return { sidebarWidth: value.sidebarWidth, previewWidth: value.previewWidth };
            });
            expect(resizedPreferences).toEqual({
              sidebarWidth: sidebarBeforeDrag - 12,
              previewWidth: previewBeforeDrag - 12,
            });
            expect(await mainWindow.evaluate(() =>
              (window as Window & { __previewColorEvents: number }).__previewColorEvents,
            )).toBe(0);

            await nativeWindow.evaluate((win) => win.setSize(1920, 1080));
            await expect.poll(() => mainWindow.locator("#sidebar").evaluate((element) => element.getBoundingClientRect().width))
              .toBe(resizedPreferences.sidebarWidth);
            await expect.poll(() => mainWindow.locator("#preview-panel").evaluate((element) => element.getBoundingClientRect().width))
              .toBe(resizedPreferences.previewWidth);
            await nativeWindow.evaluate((win, size) => win.setSize(size.width, size.height), windowCase);
          }

          await mainWindow.locator("#btn-expand-viewer").click();
          await expect(mainWindow.locator("#preview-panel")).toHaveClass(/expanded/);
          await expect(mainWindow.locator("#preview-panel")).not.toHaveClass(/overlay/);
          await mainWindow.locator("#btn-expand-viewer").click();

          await mainWindow.locator("#btn-close-viewer").click();
          await expect(mainWindow.locator("#preview-panel")).toHaveClass(/hidden/);

          const lastModelCard = mainWindow.locator(".file-card").filter({
            has: mainWindow.locator(".card-name[title='library model 38']"),
          }).first();
          await mainWindow.evaluate(() => {
            const scroller = document.querySelector("[data-virtuoso-scroller]");
            if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
          });
          await expect(lastModelCard).toBeVisible();
          await lastModelCard.locator(".file-select-toggle").click();
          const lastModelName = lastModelCard.locator(".card-name");
          await lastModelName.scrollIntoViewIfNeeded();
          const scrollTopBeforePreview = await mainWindow.evaluate(() =>
            document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
          );
          expect(scrollTopBeforePreview).toBeGreaterThan(0);
          await lastModelName.click();
          await expect(mainWindow.locator("#preview-panel")).not.toHaveClass(/hidden/);
          await expect(mainWindow.locator("#viewer-loading")).toHaveClass(/hidden/, { timeout: 30000 });
          const scrollTopAfterPreview = await mainWindow.evaluate(() =>
            document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
          );
          if (measurements.previewMode === "overlay") {
            await expect(lastModelName).toBeVisible();
            expect(scrollTopAfterPreview).toBe(scrollTopBeforePreview);
          } else {
            expect(scrollTopAfterPreview).toBeGreaterThan(0);
          }
          await mainWindow.locator("#btn-close-viewer").click();
          await expect(mainWindow.locator("#preview-panel")).toHaveClass(/hidden/);
          if (measurements.previewMode === "overlay") await expect(lastModelName).toBeVisible();
          await expect(mainWindow.locator("#batch-actions")).toContainText("1 selected");
          const scrollTopAfterClose = await mainWindow.evaluate(() =>
            document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
          );
          if (measurements.previewMode === "overlay") {
            expect(scrollTopAfterClose).toBe(scrollTopBeforePreview);
          } else {
            expect(scrollTopAfterClose).toBeGreaterThan(0);
          }
        }
      }
    }
    const measurementPath = testInfo.outputPath("responsive-layout-measurements.json");
    fs.writeFileSync(measurementPath, JSON.stringify(measurementsByCase, null, 2));
    await testInfo.attach("responsive-layout-measurements.json", {
      path: measurementPath,
      contentType: "application/json",
    });
  } finally {
    await isolated.close();
  }
});
