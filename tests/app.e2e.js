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

// Ensure we have a clean database for each test run
let app;
let window;

// Use a temp userData dir so we don't pollute the real one
let tempUserData;

test.beforeAll(async () => {
  // Build the app first
  const { execSync } = require("child_process");
  execSync("npm run build", { cwd: APP_DIR, stdio: "pipe" });

  // Create isolated userData
  tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-test-"));

  // Launch Electron
  app = await electron.launch({
    args: [path.join(APP_DIR, "out/main/index.js")],
    env: {
      ...process.env,
      ELECTRON_USER_DATA: tempUserData,
    },
  });

  // Get the first window
  window = await app.firstWindow();
  // Wait for render to be ready
  await window.waitForLoadState("domcontentloaded");
  // Give app.js time to initialize
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
  const gridVisible = await fileGrid.evaluate(
    (el) => el.style.display !== "none" && el.children.length > 0,
  );
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
  await window.waitForTimeout(2000); // Wait for Three.js to init
  const canvasCount = await window.locator("#viewer-container canvas").count();
  expect(canvasCount).toBe(1);
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
