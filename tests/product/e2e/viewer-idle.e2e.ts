const { test, expect } = require("@playwright/test");
const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { buildElectronLaunchEnv } = require("../../support/helpers/electronLaunch");

const APP_DIR = path.resolve(__dirname, "../../..");
const FIXTURE_DIR = path.join(__dirname, "../../support/fixtures");
const RUNTIME_SETTINGS = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 500,
  thumbnailColor: "#8888aa",
};

let app;
let window;
let tempUserData;

async function findMainWindow(electronApp) {
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const page of electronApp.windows()) {
      try {
        await page.locator("#search-input").waitFor({ timeout: 1000 });
        return page;
      } catch { /* Wait for the renderer to finish loading. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Main window did not become ready");
}

test.beforeAll(async () => {
  const { execSync } = require("child_process");
  execSync("npm run build", { cwd: APP_DIR, stdio: "pipe" });
  tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-viewer-idle-"));
  const args = [path.join(APP_DIR, "out/main/index.js"), `--user-data-dir=${tempUserData}`];
  if (process.platform === "linux") args.push("--no-sandbox", "--disable-gpu");
  app = await electron.launch({
    args,
    env: buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: tempUserData }),
  });
  await app.firstWindow();
  window = await findMainWindow(app);
  await window.waitForLoadState("domcontentloaded");
  await window.evaluate(() => {
    const probe = {
      viewerFrames: 0,
      webglDrawCalls: 0,
      markViewerFrame() { this.viewerFrames++; },
      markViewerDrawCalls(count) { this.webglDrawCalls += count; },
    };
    window.__POLYTRAY_RENDERER_PROBE = probe;
  });
  await window.evaluate(({ folder, settings }) => window.polytray.scanFolder(folder, settings), {
    folder: FIXTURE_DIR,
    settings: RUNTIME_SETTINGS,
  });
  await window.waitForFunction(() => document.querySelectorAll(".file-card").length > 0, { timeout: 30000 });
});

test.afterAll(async () => {
  if (app) await app.close();
  if (tempUserData && fs.existsSync(tempUserData)) fs.rmSync(tempUserData, { recursive: true, force: true });
});

test("settled preview schedules no viewer frames and disposes cleanly across reopen cycles", async () => {
  const card = window.locator(".file-card").filter({ hasText: "test_cube.obj" }).first();
  await expect(card).toBeVisible();
  const canvas = window.locator("#viewer-container canvas");
  const close = window.locator("#btn-close-viewer");

  for (let cycle = 0; cycle < 3; cycle++) {
    await card.click();
    await expect(canvas).toHaveCount(1, { timeout: 15000 });
    await expect(window.locator("#preview-panel")).not.toHaveClass(/hidden/);
    await window.waitForFunction(() => {
      const loading = document.querySelector("#viewer-loading");
      return !loading || getComputedStyle(loading).display === "none";
    }, { timeout: 30000 });
    await window.waitForFunction(async () => {
      const probe = window.__POLYTRAY_RENDERER_PROBE;
      const framesAtStart = probe.viewerFrames;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return probe.viewerFrames === framesAtStart;
    }, { timeout: 10000 });

    const settledCounts = await window.evaluate(() => ({
      viewerFrames: window.__POLYTRAY_RENDERER_PROBE.viewerFrames,
      webglDrawCalls: window.__POLYTRAY_RENDERER_PROBE.webglDrawCalls,
    }));
    expect(settledCounts.viewerFrames, "instrumentation runs after actual rendering").toBeGreaterThan(0);

    await window.evaluate(() => {
      const probe = window.__POLYTRAY_RENDERER_PROBE;
      probe.viewerFrames = 0;
      probe.webglDrawCalls = 0;
    });
    await window.waitForTimeout(1000);
    const counts = await window.evaluate(() => ({
      viewerFrames: window.__POLYTRAY_RENDERER_PROBE.viewerFrames,
      webglDrawCalls: window.__POLYTRAY_RENDERER_PROBE.webglDrawCalls,
    }));
    expect(counts.viewerFrames, "actual viewer renders after settling").toBe(0);
    expect(counts.webglDrawCalls, "WebGL draw calls are measured separately from frames").toBe(0);

    await close.click();
    await expect(window.locator("#preview-panel")).toHaveClass(/hidden/);
    await expect(canvas).toHaveCount(0);
  }
});
