const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");

(async () => {
  console.log("Starting UI Verification...");
  const APP_DIR = path.resolve(__dirname, "..");
  const FIXTURE_DIR = path.join(__dirname, "fixtures");
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-test-"));

  const app = await electron.launch({
    args: [path.join(APP_DIR, "out/main/index.js")],
    env: { ...process.env, ELECTRON_USER_DATA: tempUserData },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(1000);

  console.log("App launched. Scanning folder...");
  await window.evaluate((fixturePath) => {
    return window.polytray.scanFolder(fixturePath);
  }, FIXTURE_DIR);

  await window.waitForTimeout(4000); // wait for scan and thumbnails

  // 1. Check Scroll
  const scrollInfo = await window.evaluate(() => {
    const grid = document.getElementById("file-grid");
    if (!grid) return null;
    return {
      scrollHeight: grid.scrollHeight,
      clientHeight: grid.clientHeight,
      overflowY: window.getComputedStyle(grid).overflowY,
      flex: window.getComputedStyle(grid).flex,
    };
  });
  console.log("Scroll Info:", scrollInfo);

  // 2. Check Thumbnails
  const thumbCount = await window.locator(".card-thumbnail img").count();
  console.log(`Thumbnails loaded: ${thumbCount}`);

  // 3. Check Preview Panel
  console.log("Opening preview panel...");
  await window.locator(".file-card").first().click();
  await window.waitForTimeout(2000); // wait for Three.js

  await window.screenshot({
    path: path.join(__dirname, "preview-screenshot.png"),
  });
  console.log("Screenshot saved to preview-screenshot.png");

  // 4. Click Rescan
  console.log("Clicking Rescan...");
  await window.locator("#btn-rescan").click();

  // check progress visibility
  const progressClasses = await window
    .locator("#scan-progress")
    .getAttribute("class");
  console.log(`Scan Progress classes during rescan: ${progressClasses}`);

  await window.waitForTimeout(2000);

  await app.close();
  fs.rmSync(tempUserData, { recursive: true, force: true });
  console.log("Verification complete.");
})().catch(console.error);
