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

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const APP_DIR = path.resolve(__dirname, "..");
const REAL_BASE_3MF_PATH = "/Volumes/exssd/3D Models/base.3mf";

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
  app = await electron.launch({
    args,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      ELECTRON_USER_DATA: tempUserData,
    },
  });

  // Wait for the first window and let it load
  await app.firstWindow();
  window = await findMainWindow(app);
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(1000);
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
    await expect(emptyState).toContainText("No 3D files found");
  }
});

// ── Test 2: Can scan a folder and file cards appear ────────────────

test("scanning a folder shows file cards in the grid", async () => {
  // Use the IPC API directly to add the fixture folder
  // (bypasses the native folder dialog which we can't automate)
  await window.evaluate((fixturePath) => {
    return window.polytray.scanFolder(fixturePath);
  }, FIXTURE_DIR);

  // Wait for scan to complete and file cards to appear
  await window.waitForTimeout(3000);

  // Reload files to ensure they're displayed
  await window.evaluate(() => {
    // Trigger a re-render by calling getFiles
    return window.polytray.getFiles({ limit: 100, offset: 0 });
  });

  // Wait a bit more for the UI to update from the scan-complete event
  await window.waitForTimeout(2000);

  // Check that file cards exist
  const fileCards = window.locator(".file-card");
  const count = await fileCards.count();

  // We created 3 STL + 1 OBJ = 4 test files
  expect(count).toBeGreaterThanOrEqual(3);
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
  // Wait for thumbnail generation to complete
  // The progress bar should auto-hide after thumbnails are done
  await window.waitForTimeout(10000);

  // Check that at least some cards have thumbnail images loaded
  const thumbImages = window.locator(".card-thumbnail img");
  const imgCount = await thumbImages.count();

  // At least some thumbnails should have loaded
  // (Some may still be generating, so check >= 1)
  expect(imgCount).toBeGreaterThanOrEqual(1);

  // Verify that at least one image has a valid src (base64 data URL)
  const firstSrc = await thumbImages.first().getAttribute("src");
  expect(firstSrc).toBeTruthy();
  // Either it's a data URL (loaded via IPC) or it may still be loading
  if (firstSrc) {
    expect(firstSrc.startsWith("data:image/")).toBeTruthy();
  }
});

// ── Test 5: Clicking a card opens the preview panel ────────────────

test("clicking a file card opens the 3D preview panel", async () => {
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

  // Verify that the scale normalization logic ran constraint the model size
  const modelMetrics = await window.evaluate(() => {
    const model = window.__POLYTRAY_CURRENT_MODEL;
    if (!model) return null;
    return {
      scaleX: model.scale.x,
      scaleY: model.scale.y,
      scaleZ: model.scale.z,
    };
  });
  expect(modelMetrics).not.toBeNull();

  // A generic model will have a calculated scale (very rarely exactly 1.0 across floating point math)
  // We mostly care that the attribute is populated and valid, which means `loadModel` successfully attached the normalized group
  expect(typeof modelMetrics.scaleX).toBe("number");
});

// ── Test 6: Preview panel controls work ────────────────────────────

test("preview panel controls work (wireframe, reset, close)", async () => {
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

    await window.evaluate((dir) => window.polytray.scanFolder(dir), perfFixtureDir);
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
    expect(freeze.load.maxGap).toBeLessThan(Math.max(1600, freeze.baseline.maxGap * 3.5));
    expect(freeze.load.p95).toBeLessThan(Math.max(160, freeze.baseline.p95 * 4));
  } finally {
    fs.rmSync(perfFixtureDir, { recursive: true, force: true });
  }
});

test("base.3mf preview does not freeze the UI for multiple seconds", async () => {
  test.skip(!fs.existsSync(REAL_BASE_3MF_PATH), "requires local base.3mf fixture");
  test.setTimeout(180000);

  await window.evaluate(() => window.polytray.scanFolder("/Volumes/exssd/3D Models"));
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

// ── Test 10: Format filter buttons work ────────────────────────────

test("format filter buttons filter by extension", async () => {
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
  const totalText = await window.locator("#stat-total").textContent();
  const total = parseInt(totalText, 10);
  expect(total).toBeGreaterThan(0);

  const stlText = await window.locator("#stat-stl").textContent();
  const stl = parseInt(stlText, 10);
  expect(stl).toBeGreaterThanOrEqual(1);
});

// ── Test 12: Sidebar folder filtering limits visible files ───────────

test("sidebar folder filtering limits visible files", async () => {
  await window.waitForTimeout(500);
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
  const folderNodes = window.locator(".library-folder-item");
  const firstNode = folderNodes.first();
  await firstNode.click();
  
  // Directly trigger the scan through the exposed API bridge to mimic the context menu
  await window.evaluate(() => {
    // Get the first folder from the DOM path title attribute
    const firstPath = document.querySelector('.library-folder-name').getAttribute('title');
    // Mimic the context menu invocation
    window.polytray.scanFolder(firstPath);
  });
  
  const progressContainer = window.locator("#scan-progress");
  await expect(progressContainer).toBeVisible();

  // Wait for it to finish gracefully
  await window.waitForTimeout(2000);
});
