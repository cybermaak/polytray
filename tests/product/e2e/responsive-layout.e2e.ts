const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { launchIsolatedApp } = require("../../support/helpers/isolatedApp");
const { attachJsonFailureEvidence } = require("../../support/helpers/failureEvidence");

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

async function dismissTerminalBackgroundJobs(page) {
  const activeStates = ["queued", "running", "pausing", "paused", "cancelling"];
  await expect.poll(() => page.evaluate(async (active) =>
    (await window.polytray.getBackgroundJobs()).every((job) => !active.includes(job.state)), activeStates,
  ), { timeout: 60000 }).toBe(true);
  const terminalJobIds = await page.evaluate(async (active) => (await window.polytray.getBackgroundJobs())
    .filter((job) => !active.includes(job.state))
    .map((job) => job.jobId), activeStates);
  for (const jobId of terminalJobIds) {
    const panel = page.locator(".background-work-details");
    if (await panel.count()) await panel.evaluate((element) => { element.open = true; });
    const card = page.locator(`.background-job[data-job-id="${jobId}"]`);
    const dismiss = card.getByRole("button", { name: "Dismiss" });
    if (await dismiss.count()) {
      await dismiss.evaluate((button) => button.click());
      await expect(card).toHaveCount(0);
    }
  }
  await expect(page.locator("#scan-progress")).toHaveClass(/hidden/, { timeout: 30000 });
}

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
    const rendererErrors = [];
    const observePage = (candidate) => {
      const note = (message) => {
        if (rendererErrors.length < 30) rendererErrors.push({ url: candidate.url(), message: String(message).slice(0, 500) });
      };
      candidate.on('console', entry => { if (entry.type() === 'error') note(entry.text()); });
      candidate.on('pageerror', error => note(error));
    };
    isolated.app.windows().forEach(observePage);
    isolated.app.on('window', observePage);
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
    try {
      // Hosted software rendering settles about 20 of 40 serial thumbnails per minute.
      await expect.poll(() => mainWindow.evaluate(async () => {
        const result = await window.polytray.getFiles({ limit: 500, offset: 0 });
        return result.files.filter((file) => file.thumbnail || file.thumbnail_failed).length;
      }), { timeout: 150000 }).toBeGreaterThanOrEqual(40);
    } catch (error) {
      await attachJsonFailureEvidence('thumbnail-settlement-state', async () => {
        const cacheDir = path.join(isolated.userDataDir, 'thumbnails');
        return {
          windowUrls: isolated.app.windows().map(candidate => candidate.url()),
          rendererErrors,
          cacheFiles: fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).slice(0, 60) : [],
          renderer: await mainWindow.evaluate(async () => {
            const [files, jobs] = await Promise.all([
              window.polytray.getFiles({ limit: 500, offset: 0 }),
              window.polytray.getBackgroundJobs(),
            ]);
            return {
              total: files.total,
              thumbnailRows: files.files.map(file => ({
                id: file.id, path: file.path, contentRevision: file.content_revision,
                thumbnail: file.thumbnail, thumbnailFailed: file.thumbnail_failed,
              })),
              jobs,
            };
          }),
        };
      });
      throw error;
    }
    await dismissTerminalBackgroundJobs(mainWindow);
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
          const selectedPath = await longNameCard.getAttribute('title');
          await longNameCard.locator(".card-name").click();
          await expect(mainWindow.locator("#preview-panel")).not.toHaveClass(/hidden/);
          try {
            await expect(mainWindow.locator("#viewer-loading")).toHaveClass(/hidden/, { timeout: 30000 });
          } catch (error) {
            await attachJsonFailureEvidence('responsive-preview-state', async () => ({
              sizeCase, windowCase, lightMode, rendererErrors,
              windowUrls: isolated.app.windows().map(candidate => candidate.url()),
              workerUrls: mainWindow.workers().map(worker => worker.url()),
              selectedPath,
              renderer: await mainWindow.evaluate(async (filePath) => {
                const container = document.querySelector<HTMLElement>('#viewer-container')?.getBoundingClientRect();
                let fetchProbe: unknown = null;
                if (filePath) {
                  const controller = new AbortController();
                  const timer = setTimeout(() => controller.abort(), 2_000);
                  try {
                    const response = await fetch(`polytray://local/${encodeURIComponent(filePath)}`, { signal: controller.signal });
                    fetchProbe = { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
                  } catch (cause) { fetchProbe = { error: String(cause) }; }
                  finally { clearTimeout(timer); }
                }
                return {
                  loadingClass: document.querySelector('#viewer-loading')?.className ?? null,
                  loadingText: document.querySelector('#viewer-loading')?.textContent ?? null,
                  container: container ? { width: container.width, height: container.height } : null,
                  pending: window.polytray.__previewParsePendingCounts?.() ?? null,
                  jobs: await window.polytray.getBackgroundJobs(),
                  fetchProbe,
                };
              }, selectedPath),
            }));
            throw error;
          }
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
          if (measurements.previewMode === "overlay") {
            await expect(lastModelName).toBeVisible();
            await expect(lastModelCard).toBeFocused();
          }
          await expect(mainWindow.locator("#batch-actions")).toContainText("1 selected");
          const scrollTopAfterClose = await mainWindow.evaluate(() =>
            document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
          );
          if (measurements.previewMode === "overlay") {
            expect(scrollTopAfterClose).toBe(scrollTopBeforePreview);
            if (sizeCase.name === "default" && windowCase.width === 900 && !lightMode) {
              await mainWindow.evaluate(() => {
                const state = window as any;
                state.__u04OpenerFocusCalls = [];
                state.__u04OriginalFocus = HTMLElement.prototype.focus;
                HTMLElement.prototype.focus = function (options?: FocusOptions) {
                  if (this.matches(".file-card")
                    && this.querySelector(".card-name[title='library model 38']")) {
                    state.__u04OpenerFocusCalls.push(options?.preventScroll ?? null);
                  }
                  return state.__u04OriginalFocus.call(this, options);
                };
              });
              await lastModelName.click();
              await expect(mainWindow.locator("#preview-panel")).not.toHaveClass(/hidden/);
              await expect(mainWindow.locator("#viewer-loading")).toHaveClass(/hidden/, { timeout: 30000 });
              const scrollTopAtReopen = await mainWindow.evaluate(() =>
                document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
              );
              const exposedGridPoint = await mainWindow.evaluate(() => {
                const scroller = document.querySelector<HTMLElement>("[data-virtuoso-scroller]");
                const preview = document.querySelector<HTMLElement>("#preview-panel");
                if (!scroller || !preview) throw new Error("Overlay scroll target is unavailable");
                const scrollBounds = scroller.getBoundingClientRect();
                const previewBounds = preview.getBoundingClientRect();
                const right = Math.min(scrollBounds.right, previewBounds.left);
                const x = Math.floor((scrollBounds.left + right) / 2);
                const y = Math.floor((scrollBounds.top + scrollBounds.bottom) / 2);
                if (right <= scrollBounds.left || !scroller.contains(document.elementFromPoint(x, y))) {
                  throw new Error("No exposed grid area is available beside the preview overlay");
                }
                return { x, y };
              });
              await mainWindow.mouse.move(exposedGridPoint.x, exposedGridPoint.y);
              const readOpenerState = () => mainWindow.evaluate(() => {
                const card = document.querySelector<HTMLElement>(
                  ".file-card .card-name[title='library model 38']",
                )?.closest<HTMLElement>(".file-card");
                const scroller = document.querySelector("[data-virtuoso-scroller]");
                if (!card || !scroller) return null;
                const cardBounds = card.getBoundingClientRect();
                const scrollBounds = scroller.getBoundingClientRect();
                return {
                  connected: card.isConnected,
                  offscreen: cardBounds.bottom <= scrollBounds.top || cardBounds.top >= scrollBounds.bottom,
                  cardTop: cardBounds.top,
                  cardBottom: cardBounds.bottom,
                  scrollerTop: scrollBounds.top,
                  scrollerBottom: scrollBounds.bottom,
                };
              });
              let openerState = await readOpenerState();
              let observedScrollTop = scrollTopAtReopen;
              for (let attempt = 0; attempt < 40 && openerState && !openerState.offscreen; attempt++) {
                // Keep the virtualized card inside its overscan window while moving it just offscreen.
                await mainWindow.mouse.wheel(0, -80);
                await expect.poll(() => mainWindow.evaluate(() =>
                  document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
                )).not.toBe(observedScrollTop);
                observedScrollTop = await mainWindow.evaluate(() =>
                  document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
                );
                openerState = await readOpenerState();
              }
              expect(openerState?.connected && openerState.offscreen).toBe(true);
              const scrollTopAtClose = await mainWindow.evaluate(() =>
                document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
              );
              await mainWindow.locator("#btn-close-viewer").click();
              await expect(mainWindow.locator("#preview-panel")).toHaveClass(/hidden/);
              await expect(lastModelCard).toBeFocused();
              const openerFocusOptions = await mainWindow.evaluate(() => {
                const state = window as any;
                const options = state.__u04OpenerFocusCalls as Array<boolean | null>;
                HTMLElement.prototype.focus = state.__u04OriginalFocus;
                delete state.__u04OpenerFocusCalls;
                delete state.__u04OriginalFocus;
                return options;
              });
              expect(openerFocusOptions.at(-1)).toBe(true);
              await expect.poll(() => mainWindow.evaluate(() =>
                document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0,
              )).toBe(scrollTopAtClose);
            }
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
