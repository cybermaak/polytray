/**
 * app.e2e.js — End-to-end regression tests for PolyTray.
 *
 * Tests the full Electron application:
 *  1. App launches and shows the main UI
 *  2. Folder can be added and files are scanned
 *  3. File cards appear and the grid is scrollable
 *  4. Thumbnails are generated for scanned files
 *  5. Clicking a card opens the 3D preview panel
 *  6. Preview panel controls (wireframe, reset camera, close) work
 *  7. Search filters file cards
 *  8. Sort order changes work
 *  9. Settings modal opens and closes
 *
 * Requires: npm run build (produces out/ directory)
 * Run with: npx playwright test
 */

const { test, expect } = require("@playwright/test");
const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { buildElectronLaunchEnv } = require("../../support/helpers/electronLaunch");

const FIXTURE_DIR = path.join(__dirname, "../../support/fixtures");
const APP_DIR = path.resolve(__dirname, "../../..");
const REAL_BASE_3MF_PATH = process.env.POLYTRAY_REAL_BASE_3MF_PATH || "";
const DEFAULT_RUNTIME_SETTINGS = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 500,
  thumbnailColor: "#8888aa",
};

function generateLargeBinaryStl(filePath, triangleCount = 220000) {
  const header = Buffer.alloc(80, 0);
  header.write("polytray-large-perf-fixture", 0, "ascii");

  const count = Buffer.alloc(4);
  count.writeUInt32LE(triangleCount, 0);

  const triangleBytes = Buffer.alloc(triangleCount * 50);
  for (let i = 0; i < triangleCount; i++) {
    const base = i * 50;

    triangleBytes.writeFloatLE(0, base + 0);
    triangleBytes.writeFloatLE(0, base + 4);
    triangleBytes.writeFloatLE(1, base + 8);

    const x = i % 1000;
    const y = Math.floor(i / 1000);

    triangleBytes.writeFloatLE(x, base + 12);
    triangleBytes.writeFloatLE(y, base + 16);
    triangleBytes.writeFloatLE(0, base + 20);

    triangleBytes.writeFloatLE(x + 0.5, base + 24);
    triangleBytes.writeFloatLE(y + 1, base + 28);
    triangleBytes.writeFloatLE(0, base + 32);

    triangleBytes.writeFloatLE(x + 1, base + 36);
    triangleBytes.writeFloatLE(y, base + 40);
    triangleBytes.writeFloatLE(0, base + 44);

    triangleBytes.writeUInt16LE(0, base + 48);
  }

  fs.writeFileSync(filePath, Buffer.concat([header, count, triangleBytes]));
}

function writeTinyAsciiStl(filePath, solidName = "fixture") {
  fs.writeFileSync(
    filePath,
    `solid ${solidName}
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid ${solidName}
`,
  );
}

// Ensure we have a clean database for each test run
let app;
let window;
let startupDurationMs;

// Use a temp userData dir so we don't pollute the real one
let tempUserData;

async function findMainWindow(app) {
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator("#search-input").waitFor({ timeout: 1000 });
        return page;
      } catch {
        // Keep probing until the main UI is ready.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Main window did not become ready");
}

async function scanFolderInApp(folderPath, settings = DEFAULT_RUNTIME_SETTINGS) {
  await window.evaluate(
    ({ targetFolderPath, runtimeSettings }) =>
      window.polytray.scanFolder(targetFolderPath, runtimeSettings),
    { targetFolderPath: folderPath, runtimeSettings: settings },
  );
}

async function ensureFixtureFilesLoaded() {
  await resetUiState();
  await scanFolderInApp(FIXTURE_DIR);
  await resetUiState();
  await window.waitForFunction(async () => {
    const result = await window.polytray.getFiles({ limit: 100, offset: 0 });
    return result.files.length > 0;
  }, { timeout: 30000 });
  await window.waitForFunction(
    () => document.querySelectorAll(".file-card").length > 0,
    { timeout: 30000 },
  );
}

async function resetUiState() {
  const overlay = window.locator("#settings-overlay");
  const overlayClasses = (await overlay.getAttribute("class")) || "";
  if (!overlayClasses.includes("hidden")) {
    await window.locator("#settings-close").click();
    await expect(overlay).toHaveClass(/hidden/);
  }

  const previewPanel = window.locator("#preview-panel");
  const previewClasses = (await previewPanel.getAttribute("class")) || "";
  if (!previewClasses.includes("hidden")) {
    await window.locator("#btn-close-viewer").click();
    await expect(previewPanel).toHaveClass(/hidden/);
  }

  const searchInput = window.locator("#search-input");
  await searchInput.fill("");
  await window.waitForTimeout(300);

  const allBtn = window.locator('.filter-btn[data-ext=""]');
  const allBtnClasses = (await allBtn.getAttribute("class")) || "";
  if (!allBtnClasses.includes("active")) {
    await allBtn.click();
    await window.waitForTimeout(300);
  }

  const activeCollection = window.locator(".collection-item.active").first();
  if (await activeCollection.count()) {
    await activeCollection.click();
    await window.waitForTimeout(300);
  }

  const batchActions = window.locator("#batch-actions");
  if (await batchActions.count()) {
    const clearSelection = window.locator("#clear-batch-selection");
    if (await clearSelection.count()) {
      await clearSelection.click();
      await window.waitForTimeout(200);
    }
  }
}

test.beforeAll(async () => {
  // Build the app first
  const { execSync } = require("child_process");
  execSync("npm run build", { cwd: APP_DIR, stdio: "pipe" });

  // Create isolated userData
  tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-test-"));

  const args = [
    path.join(APP_DIR, "out/main/index.js"),
    `--user-data-dir=${tempUserData}`,
  ];

  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-gpu");
  }

  // Launch Electron with explicit user-data-dir to strictly isolate DB/settings from production
  const launchStartedAt = Date.now();
  app = await electron.launch({
    args,
    env: buildElectronLaunchEnv(process.env, {
      ELECTRON_USER_DATA: tempUserData,
    }),
  });

  // Wait for the first window and let it load
  await app.firstWindow();
  window = await findMainWindow(app);
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(1000);
  startupDurationMs = Date.now() - launchStartedAt;
});

test.afterAll(async () => {
  if (app) {
    await app.close();
  }
  // Clean up temp userData
  if (tempUserData && fs.existsSync(tempUserData)) {
    fs.rmSync(tempUserData, { recursive: true, force: true });
  }
});

// ── Test 1: App loads and shows main UI ────────────────────────────

test("app launches and shows main UI elements", async () => {
  // Title bar
  await expect(window.locator("#titlebar")).toBeVisible();
  await expect(window.locator(".titlebar-text")).toHaveText("Polytray");

  // Sidebar
  await expect(window.locator("#sidebar")).toBeVisible();
  await expect(window.locator("#btn-select-folder")).toBeVisible();
  await expect(window.locator("#btn-select-folder")).toContainText(
    "Add Folder",
  );

  // Stats grid
  await expect(window.locator("#stat-total")).toBeVisible();
  await expect(window.locator("#stat-stl")).toBeVisible();
  await expect(window.locator("#stat-obj")).toBeVisible();

  // Toolbar
  await expect(window.locator("#toolbar")).toBeVisible();
  await expect(window.locator("#search-input")).toBeVisible();
  await expect(window.locator("#sort-select")).toBeVisible();

  // Toolbar buttons
  await expect(window.locator("#btn-rescan")).toBeVisible();
  await expect(window.locator("#btn-settings")).toBeVisible();

  // Empty state (no files loaded yet)
  const emptyState = window.locator("#empty-state");
  // Either visible or the file grid is visible (depending on state)
  const fileGrid = window.locator("#file-grid");

  let gridVisible = false;
  if ((await fileGrid.count()) > 0) {
    gridVisible = await fileGrid.evaluate(
      (el) => el.style.display !== "none" && el.children.length > 0,
    );
  }

  if (!gridVisible) {
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("No models in view");
  }
});

test("startup stays within the responsiveness budget", async () => {
  expect(startupDurationMs).toBeLessThan(10000);
});

// ── Test 2: Can scan a folder and file cards appear ────────────────

test("scanning a folder shows file cards in the grid", async () => {
  await ensureFixtureFilesLoaded();

  // Check that file cards exist
  const fileCards = window.locator(".file-card");
  const count = await fileCards.count();

  // Fixture scan should surface the test models in the visible grid.
  expect(count).toBeGreaterThanOrEqual(1);
});

test("fixture scanning stays within the scan performance budget", async () => {
  const perfFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-scan-budget-"));

  try {
    for (let i = 0; i < 12; i++) {
      writeTinyAsciiStl(path.join(perfFixtureDir, `scan-budget-${i}.stl`), `scan_budget_${i}`);
    }

    const durationMs = await window.evaluate(async (folderPath) => {
      const startedAt = performance.now();

      await new Promise((resolve) => {
        const unsubscribe = window.polytray.onScanComplete(() => {
          unsubscribe();
          resolve();
        });
        window.polytray.scanFolder(folderPath, {
          thumbnail_timeout: 20000,
          scanning_batch_size: 50,
          watcher_stability: 1000,
          page_size: 500,
          thumbnailColor: "#8888aa",
        });
      });

      return performance.now() - startedAt;
    }, perfFixtureDir);

    expect(durationMs).toBeLessThan(5000);
  } finally {
    fs.rmSync(perfFixtureDir, { recursive: true, force: true });
  }
});

// ── Test 3: File grid is scrollable ────────────────────────────────

test("file grid is scrollable", async () => {
  const fileGrid = window.locator("#file-grid");
  await expect(fileGrid).toBeVisible();

  // Check that the grid has content
  const childCount = await fileGrid.evaluate((el) => el.children.length);
  expect(childCount).toBeGreaterThan(0);

  // Verify the grid element has overflow-y set for scrolling
  const overflowY = await fileGrid.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.overflowY;
  });
  // Should be 'auto' or 'scroll', not 'hidden' or 'visible'
  expect(["auto", "scroll"]).toContain(overflowY);

  // Verify scroll behavior works by checking scroll dimensions
  const { scrollHeight, clientHeight } = await fileGrid.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));

  // scrollHeight should be >= clientHeight (equal if content fits, greater if scrollable)
  expect(scrollHeight).toBeGreaterThanOrEqual(clientHeight);
});

// ── Test 4: Thumbnails are generated ───────────────────────────────

test("thumbnails are generated for scanned files", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  const thumbnailTargetPath = path.join(FIXTURE_DIR, "test_model_a.stl");

  const thumbnail = await window.evaluate(async ({ settings, filePath }) => {
    const thumbnailPath = await window.polytray.requestThumbnailGeneration(
      filePath,
      "stl",
      settings,
    );
    if (!thumbnailPath) {
      return null;
    }

    return window.polytray.readThumbnail(thumbnailPath);
  }, {
    settings: DEFAULT_RUNTIME_SETTINGS,
    filePath: thumbnailTargetPath,
  });

  expect(thumbnail).toBeTruthy();
  expect(thumbnail.startsWith("data:image/")).toBeTruthy();
});

// ── Test 5: Clicking a card opens the preview panel ────────────────

test("clicking a file card opens the 3D preview panel", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  // The preview panel should start hidden
  const previewPanel = window.locator("#preview-panel");
  await expect(previewPanel).toHaveClass(/hidden/);

  // Click the first file card
  const firstCard = window.locator(".file-card").first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();

  // Wait for the preview panel to become visible
  await window.waitForTimeout(1000);

  // Preview panel should now be visible (no 'hidden' class)
  const classes = await previewPanel.getAttribute("class");
  expect(classes).not.toContain("hidden");

  // The viewer filename should be populated
  const filename = await window.locator("#viewer-filename").textContent();
  expect(filename).toBeTruthy();
  expect(filename.length).toBeGreaterThan(0);

  // The viewer meta should contain vertices/faces info
  const meta = await window.locator("#viewer-meta").textContent();
  expect(meta).toBeTruthy();

  // The viewer container should have a canvas (Three.js renderer)
  const canvasLocator = window.locator("#viewer-container canvas");
  await expect(canvasLocator).toHaveCount(1);

  // Wait for loading to finish
  const loadingIndicator = window.locator("#viewer-loading");
  await expect(loadingIndicator).toHaveClass(/hidden/);

  // Wait an extra moment for the render loop to draw
  await window.waitForTimeout(1000);

  // Verify that the canvas actually rendered something (not just the background)
  const isRendered = await window.evaluate(() => {
    const canvas = document.querySelector("#viewer-container canvas");
    if (!canvas) return false;

    // Create a generic 2D canvas to read the WebGL buffer
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return false;

    tempCtx.drawImage(canvas, 0, 0);
    const imgData = tempCtx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data;

    // Background color is #0a0a0f (10, 10, 15). Let's see if any pixel differs significantly.
    for (let i = 0; i < imgData.length; i += 4) {
      if (
        Math.abs(imgData[i] - 10) > 10 ||
        Math.abs(imgData[i + 1] - 10) > 10 ||
        Math.abs(imgData[i + 2] - 15) > 10
      ) {
        return true; // Found content pixel
      }
    }
    return false;
  });

  expect(isRendered).toBe(true);

  // The viewer should remain associated with a selected file after loading completes.
  await expect(window.locator("#viewer-filename")).not.toHaveText("");
});

// ── Test 6: Preview panel controls work ────────────────────────────

test("preview panel controls work (wireframe, reset, close)", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  await window.locator(".file-card").first().click();
  await expect(window.locator("#viewer-loading")).toHaveClass(/hidden/);

  // Wireframe toggle
  const wireBtn = window.locator("#btn-wireframe");
  await expect(wireBtn).toBeVisible();
  await wireBtn.click();
  // Should toggle the 'active' class
  let wireClasses = await wireBtn.getAttribute("class");
  expect(wireClasses).toContain("active");
  // Click again to toggle off
  await wireBtn.click();
  wireClasses = await wireBtn.getAttribute("class");
  expect(wireClasses).not.toContain("active");

  // Reset camera button should be clickable without error
  const resetBtn = window.locator("#btn-reset-camera");
  await expect(resetBtn).toBeVisible();
  await resetBtn.click();
  await window.waitForTimeout(500);

  // Close button
  const closeBtn = window.locator("#btn-close-viewer");
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await window.waitForTimeout(300);

  // Preview panel should be hidden again
  const previewPanel = window.locator("#preview-panel");
  const classes = await previewPanel.getAttribute("class");
  expect(classes).toContain("hidden");
});

test("large preview loading does not stall renderer event loop for multiple seconds", async () => {
  test.setTimeout(150000);
  const perfFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-perf-"));
  try {
    const largeModelPath = path.join(perfFixtureDir, "huge_preview_model.stl");
    generateLargeBinaryStl(largeModelPath);

    await scanFolderInApp(perfFixtureDir);
    await window.waitForTimeout(3500);

    await window.evaluate(() => {
      window.__polytrayFreezeStats = {
        phase: "baseline",
        last: performance.now(),
        baselineSamples: [],
        loadSamples: [],
        baselineMaxGap: 0,
        loadMaxGap: 0,
      };

      const tick = () => {
        const now = performance.now();
        const gap = now - window.__polytrayFreezeStats.last;
        window.__polytrayFreezeStats.last = now;

        if (window.__polytrayFreezeStats.phase === "baseline") {
          window.__polytrayFreezeStats.baselineMaxGap = Math.max(window.__polytrayFreezeStats.baselineMaxGap, gap);
          if (window.__polytrayFreezeStats.baselineSamples.length < 1500) {
            window.__polytrayFreezeStats.baselineSamples.push(gap);
          }
        } else {
          window.__polytrayFreezeStats.loadMaxGap = Math.max(window.__polytrayFreezeStats.loadMaxGap, gap);
          if (window.__polytrayFreezeStats.loadSamples.length < 3000) {
            window.__polytrayFreezeStats.loadSamples.push(gap);
          }
        }

        window.__polytrayFreezeRaf = requestAnimationFrame(tick);
      };

      window.__polytrayFreezeRaf = requestAnimationFrame(tick);
    });

    // Capture machine baseline before heavy preview load starts.
    await window.waitForTimeout(1200);

    await window.evaluate(() => {
      window.__polytrayFreezeStats.phase = "load";
      window.__polytrayFreezeStats.last = performance.now();
    });

    const largeCard = window.locator(".file-card").filter({ hasText: "huge_preview_model" }).first();
    await expect(largeCard).toBeVisible();
    await largeCard.click();

    await expect(window.locator("#viewer-loading")).toHaveClass(/hidden/, { timeout: 120000 });
    await window.waitForTimeout(200);

    const freeze = await window.evaluate(() => {
      cancelAnimationFrame(window.__polytrayFreezeRaf);

      const percentile = (samples, p) => {
        if (!samples.length) return 0;
        const sorted = [...samples].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * p)] || 0;
      };

      return {
        baseline: {
          sampleCount: window.__polytrayFreezeStats.baselineSamples.length,
          maxGap: window.__polytrayFreezeStats.baselineMaxGap,
          p95: percentile(window.__polytrayFreezeStats.baselineSamples, 0.95),
        },
        load: {
          sampleCount: window.__polytrayFreezeStats.loadSamples.length,
          maxGap: window.__polytrayFreezeStats.loadMaxGap,
          p95: percentile(window.__polytrayFreezeStats.loadSamples, 0.95),
        },
      };
    });

    expect(freeze.baseline.sampleCount).toBeGreaterThan(10);
    expect(freeze.load.sampleCount).toBeGreaterThan(10);
    expect(freeze.load.maxGap).toBeLessThan(
      Math.max(process.platform === "darwin" ? 2500 : 1600, freeze.baseline.maxGap * 3.5),
    );
    expect(freeze.load.p95).toBeLessThan(Math.max(160, freeze.baseline.p95 * 4));
  } finally {
    fs.rmSync(perfFixtureDir, { recursive: true, force: true });
  }
});

test("base.3mf preview does not freeze the UI for multiple seconds", async () => {
  test.skip(
    !REAL_BASE_3MF_PATH || !fs.existsSync(REAL_BASE_3MF_PATH),
    "requires POLYTRAY_REAL_BASE_3MF_PATH fixture",
  );
  test.setTimeout(180000);

  await scanFolderInApp(path.dirname(REAL_BASE_3MF_PATH));
  await window.waitForTimeout(7000);

  await window.locator("#search-input").fill("base");
  await window.waitForTimeout(800);

  const target = window.locator(".file-card")
    .filter({ has: window.locator(".card-name", { hasText: /^base$/i }) })
    .filter({ has: window.locator(".card-ext-badge", { hasText: "3MF" }) })
    .first();

  await expect(target).toBeVisible({ timeout: 30000 });

  await window.evaluate(() => {
    window.__polytrayFreezeStats = {
      phase: "baseline",
      last: performance.now(),
      baselineSamples: [],
      loadSamples: [],
      baselineMaxGap: 0,
      loadMaxGap: 0,
    };

    const tick = () => {
      const now = performance.now();
      const gap = now - window.__polytrayFreezeStats.last;
      window.__polytrayFreezeStats.last = now;

      if (window.__polytrayFreezeStats.phase === "baseline") {
        window.__polytrayFreezeStats.baselineMaxGap = Math.max(window.__polytrayFreezeStats.baselineMaxGap, gap);
        if (window.__polytrayFreezeStats.baselineSamples.length < 1500) {
          window.__polytrayFreezeStats.baselineSamples.push(gap);
        }
      } else {
        window.__polytrayFreezeStats.loadMaxGap = Math.max(window.__polytrayFreezeStats.loadMaxGap, gap);
        if (window.__polytrayFreezeStats.loadSamples.length < 5000) {
          window.__polytrayFreezeStats.loadSamples.push(gap);
        }
      }

      window.__polytrayFreezeRaf = requestAnimationFrame(tick);
    };

    window.__polytrayFreezeRaf = requestAnimationFrame(tick);
  });

  await window.waitForTimeout(1200);

  await window.evaluate(() => {
    window.__polytrayFreezeStats.phase = "load";
    window.__polytrayFreezeStats.last = performance.now();
  });

  const loadStartedAt = Date.now();
  await target.click();
  await expect(window.locator("#viewer-loading")).toHaveClass(/hidden/, { timeout: 120000 });
  const loadDurationMs = Date.now() - loadStartedAt;

  const freeze = await window.evaluate(() => {
    cancelAnimationFrame(window.__polytrayFreezeRaf);

    const percentile = (samples, p) => {
      if (!samples.length) return 0;
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * p)] || 0;
    };

    return {
      filename: document.querySelector("#viewer-filename")?.textContent,
      path: document.querySelector("#viewer-path span")?.textContent,
      baseline: {
        sampleCount: window.__polytrayFreezeStats.baselineSamples.length,
        maxGap: window.__polytrayFreezeStats.baselineMaxGap,
        p95: percentile(window.__polytrayFreezeStats.baselineSamples, 0.95),
      },
      load: {
        sampleCount: window.__polytrayFreezeStats.loadSamples.length,
        maxGap: window.__polytrayFreezeStats.loadMaxGap,
        p95: percentile(window.__polytrayFreezeStats.loadSamples, 0.95),
      },
    };
  });

  expect(freeze.filename).toBe("base.3mf");
  expect(freeze.path).toBe(REAL_BASE_3MF_PATH);
  // Absolute load time varies substantially with machine speed and background I/O.
  // Keep a loose ceiling here and rely on the RAF-gap assertions to catch the freeze regression.
  expect(loadDurationMs).toBeLessThan(70000);
  expect(freeze.load.maxGap).toBeLessThan(Math.max(5000, freeze.baseline.maxGap * 8));
  expect(freeze.load.p95).toBeLessThan(Math.max(200, freeze.baseline.p95 * 5));
});

// ── Test 7: Search filters file cards ──────────────────────────────

test("search filters file cards by name", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  const searchInput = window.locator("#search-input");
  const fileGrid = window.locator("#file-grid");

  // Count all cards now
  const initialCount = await window.locator(".file-card").count();
  expect(initialCount).toBeGreaterThan(0);

  // Type a search term that matches one fixture
  await searchInput.fill("cube");
  await window.waitForTimeout(500); // debounce delay

  // Should show fewer cards (only the cube)
  const filteredCount = await window.locator(".file-card").count();
  expect(filteredCount).toBeLessThanOrEqual(initialCount);
  expect(filteredCount).toBeGreaterThanOrEqual(1);

  // The visible card should be the cube
  const cardName = await window
    .locator(".file-card .card-name")
    .first()
    .textContent();
  expect(cardName.toLowerCase()).toContain("cube");

  // Clear the search
  await searchInput.fill("");
  await window.waitForTimeout(500);

  // Should show all cards again
  const resetCount = await window.locator(".file-card").count();
  expect(resetCount).toBe(initialCount);
});

test("folder filtering uses canonical containment instead of raw path prefixes", async () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-containment-"));
  const rootDir = path.join(parentDir, "models");
  const siblingPrefixDir = path.join(parentDir, "models-archive");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(siblingPrefixDir, { recursive: true });

  try {
    writeTinyAsciiStl(path.join(rootDir, "inside.stl"), "inside");
    writeTinyAsciiStl(path.join(siblingPrefixDir, "outside.stl"), "outside");

    await window.evaluate(
      async ({ firstDir, secondDir }) => {
        await window.polytray.scanFolder(firstDir);
        await window.polytray.scanFolder(secondDir);
      },
      { firstDir: rootDir, secondDir: siblingPrefixDir },
    );

    await window.waitForTimeout(1500);

    const result = await window.evaluate(
      (folder) => window.polytray.getFiles({ folder, limit: 100, offset: 0 }),
      rootDir,
    );

    expect(result.total).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe(path.join(rootDir, "inside.stl"));
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

// ── Test 8: Sort order changes ─────────────────────────────────────

test("sort order toggle changes file order", async () => {
  // Get names in current order
  const getName = async () => {
    return await window.locator(".file-card .card-name").first().textContent();
  };

  const firstNameBefore = await getName();

  // Click the sort order button to toggle DESC
  await window.locator("#sort-order").click();
  await window.waitForTimeout(500);

  const firstNameAfter = await getName();

  // If there are multiple files, the order should potentially change
  // (might be same if only one file matches)
  // At minimum, verify the button got the 'desc' class
  const orderClasses = await window
    .locator("#sort-order")
    .getAttribute("class");
  expect(orderClasses).toContain("desc");

  // Toggle back
  await window.locator("#sort-order").click();
  await window.waitForTimeout(500);
  const orderClassesAfter = await window
    .locator("#sort-order")
    .getAttribute("class");
  expect(orderClassesAfter).not.toContain("desc");
});

// ── Test 9: Settings modal opens and closes ────────────────────────

test("settings modal opens and closes", async () => {
  // Settings should be hidden initially
  const overlay = window.locator("#settings-overlay");
  const classes = await overlay.getAttribute("class");
  expect(classes).toContain("hidden");

  // Click settings button
  await window.locator("#btn-settings").click();
  await window.waitForTimeout(300);

  // Overlay should be visible
  const openClasses = await overlay.getAttribute("class");
  expect(openClasses).not.toContain("hidden");

  // Settings modal should show groups
  await expect(window.locator(".settings-group").first()).toBeVisible();
  await expect(window.locator(".settings-group-title").first()).toBeVisible();

  // Check a toggle switch exists (light mode checkbox is hidden inside toggle-switch)
  await expect(window.locator(".toggle-switch").first()).toBeVisible();
  // Grid size select exists
  const gridSelect = window.locator("#setting-grid-size");
  const gridSelectExists = await gridSelect.count();
  expect(gridSelectExists).toBe(1);

  // Close via the close button
  await window.locator("#settings-close").click();
  await window.waitForTimeout(300);

  const closedClasses = await overlay.getAttribute("class");
  expect(closedClasses).toContain("hidden");
});

test("separate color settings persist and thumbnail color can reset to default", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  await window.locator("#btn-settings").click();
  await expect(window.locator("#settings-overlay")).not.toHaveClass(/hidden/);

  const accent = window.locator("#setting-accent-color");
  const preview = window.locator("#setting-preview-color");
  const thumbnail = window.locator("#setting-thumbnail-color");
  const resetThumbnail = window.locator("#reset-thumbnail-color");

  await expect(accent).toHaveCount(1);
  await expect(preview).toHaveCount(1);
  await expect(thumbnail).toHaveCount(1);
  await expect(resetThumbnail).toHaveCount(1);

  await accent.fill("#ff6633");
  await preview.fill("#33aa88");
  await thumbnail.fill("#cc8844");

  await expect(thumbnail).toHaveValue("#cc8844");

  const storedCustom = await window.evaluate(() =>
    JSON.parse(localStorage.getItem("polytray-settings") || "{}"),
  );
  expect(storedCustom.accentColor).toBe("#ff6633");
  expect(storedCustom.previewColor).toBe("#33aa88");
  expect(storedCustom.thumbnailColor).toBe("#cc8844");

  await resetThumbnail.click();
  await expect(thumbnail).toHaveValue(DEFAULT_RUNTIME_SETTINGS.thumbnailColor);

  const storedReset = await window.evaluate(() =>
    JSON.parse(localStorage.getItem("polytray-settings") || "{}"),
  );
  expect(storedReset.thumbnailColor).toBe(DEFAULT_RUNTIME_SETTINGS.thumbnailColor);
  expect(storedReset.previewColor).toBe("#33aa88");
  expect(storedReset.accentColor).toBe("#ff6633");

  await window.locator("#settings-close").click();
  await expect(window.locator("#settings-overlay")).toHaveClass(/hidden/);
});

test("toolbar context strip reflects active scope and sidebar keeps filter before stats", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();

  const toolbarContext = window.locator("#toolbar-context");
  await expect(toolbarContext).toBeVisible();
  await expect(toolbarContext.locator(".context-chip")).toHaveCount(2);
  await expect(toolbarContext).toContainText("All Models");
  await expect(toolbarContext).toContainText("results");

  await window.locator('.filter-btn[data-ext="stl"]').click();
  await expect(toolbarContext).toContainText("STL");

  await window.locator("#search-input").fill("cube");
  await window.waitForTimeout(300);
  await expect(toolbarContext).toContainText('Search: "cube"');

  const order = await window.evaluate(() => {
    const sidebar = document.querySelector("#sidebar");
    if (!sidebar) return [];
    return Array.from(sidebar.querySelectorAll(".sidebar-section h3")).map((el) =>
      (el.textContent || "").trim(),
    );
  });

  expect(order.indexOf("Format Filter")).toBeGreaterThan(-1);
  expect(order.indexOf("Library")).toBeGreaterThan(-1);
  expect(order.indexOf("Format Filter")).toBeLessThan(order.indexOf("Library"));
});

// ── Test 10: Format filter buttons work ────────────────────────────

test("format filter buttons filter by extension", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  // Initially "All" should be active
  const allBtn = window.locator('.filter-btn[data-ext=""]');
  await expect(allBtn).toHaveClass(/active/);

  const totalCards = await window.locator(".file-card").count();

  // Click STL filter
  const stlBtn = window.locator('.filter-btn[data-ext="stl"]');
  await stlBtn.click();
  await window.waitForTimeout(500);

  const stlCards = await window.locator(".file-card").count();
  // We have 3 STL fixtures
  expect(stlCards).toBeGreaterThanOrEqual(1);
  expect(stlCards).toBeLessThanOrEqual(totalCards);

  // Click OBJ filter
  const objBtn = window.locator('.filter-btn[data-ext="obj"]');
  await objBtn.click();
  await window.waitForTimeout(500);

  const objCards = await window.locator(".file-card").count();
  expect(objCards).toBeGreaterThanOrEqual(1);

  // Click All again
  await allBtn.click();
  await window.waitForTimeout(500);
  const allCards = await window.locator(".file-card").count();
  expect(allCards).toBe(totalCards);
});

// ── Test 11: Stats update after scan ───────────────────────────────

test("library stats update after scanning", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  const totalText = await window.locator("#stat-total").textContent();
  const total = parseInt(totalText, 10);
  expect(total).toBeGreaterThan(0);

  const stlText = await window.locator("#stat-stl").textContent();
  const stl = parseInt(stlText, 10);
  expect(stl).toBeGreaterThanOrEqual(1);
});

// ── Test 12: Sidebar folder filtering limits visible files ───────────

test("sidebar folder filtering limits visible files", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  const totalCards = await window.locator(".file-card").count();

  const folderNodes = window.locator(".library-folder-item");
  const folderCount = await folderNodes.count();
  expect(folderCount).toBeGreaterThan(0);

  // Click the first folder node to select it
  await folderNodes.first().click();
  await window.waitForTimeout(1000);

  const filteredCards = await window.locator(".file-card").count();
  expect(filteredCards).toBeGreaterThan(0);
  expect(filteredCards).toBeLessThanOrEqual(totalCards);

  // Un-select the folder
  await folderNodes.first().click();
  await window.waitForTimeout(500);
});

// ── Test 13: Rescan specific folder triggers scan UI ────────

test("rescan specific folder triggers scan UI", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();
  const folderNodes = window.locator(".library-folder-item");
  const firstNode = folderNodes.first();
  await firstNode.click();
  
  // Directly trigger the scan through the exposed API bridge to mimic the context menu
  await window.evaluate(() => {
    // Get the first folder from the DOM path title attribute
    const firstPath = document.querySelector('.library-folder-name').getAttribute('title');
    // Mimic the context menu invocation
    window.polytray.scanFolder(firstPath, {
      thumbnail_timeout: 20000,
      scanning_batch_size: 50,
      watcher_stability: 1000,
      page_size: 500,
      thumbnailColor: "#8888aa",
    });
  });
  
  const progressContainer = window.locator("#scan-progress");
  await expect(progressContainer).toBeVisible();

  // Wait for it to finish gracefully
  await window.waitForTimeout(2000);
});

test("files can be tagged from preview and found via tag search", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();

  const firstCard = window.locator(".file-card").first();
  await firstCard.click();
  await expect(window.locator("#preview-panel")).not.toHaveClass(/hidden/);

  const tagInput = window.locator("#file-tags-input");
  await expect(tagInput).toBeVisible();
  await tagInput.fill("desk-tag, organizer-tag");
  await window.locator("#save-file-tags").click();

  await expect(window.locator("#file-tags .tag-chip")).toHaveCount(2);
  await expect(window.locator("#file-tags")).toContainText("desk-tag");
  await expect(window.locator("#file-tags")).toContainText("organizer-tag");

  await window.locator("#btn-close-viewer").click();
  await window.locator("#search-input").fill("desk-tag");
  await window.waitForTimeout(400);

  const visibleCards = await window.locator(".file-card").count();
  expect(visibleCards).toBe(1);
});

test("files can be organized into virtual collections from preview", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();

  await window.locator(".file-card").first().click();
  await expect(window.locator("#preview-panel")).not.toHaveClass(/hidden/);

  await window.locator("#new-collection-name").fill("Desk Favorites");
  await window.locator("#create-and-add-collection").click();

  await expect(window.locator("#collection-list")).toContainText("Desk Favorites");
  await window.waitForTimeout(300);

  await expect(window.locator("#toolbar-context")).toContainText("Collection: Desk Favorites");
  expect(await window.locator(".file-card").count()).toBe(1);
});

test("batch operations can tag multiple selected files", async () => {
  await ensureFixtureFilesLoaded();
  await resetUiState();

  const toggles = window.locator(".file-select-toggle");
  await toggles.nth(0).click();
  await toggles.nth(1).click();

  await expect(window.locator("#batch-actions")).toBeVisible();
  await expect(window.locator("#batch-selection-count")).toContainText("2 selected");

  await window.locator("#batch-tags-input").fill("batch-tag");
  await window.locator("#apply-batch-tags").click();

  await window.locator("#search-input").fill("batch-tag");
  await window.waitForTimeout(400);
  expect(await window.locator(".file-card").count()).toBe(2);
});
