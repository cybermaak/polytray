const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildElectronLaunchEnv } = require('../support/helpers/electronLaunch');

(async () => {
  console.log('Starting UI Verification...');
  const appDir = path.resolve(__dirname, '../..');
  const fixtureDir = path.join(__dirname, '../support/fixtures');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-test-'));

  const app = await electron.launch({
    args: [path.join(appDir, 'out/main/index.js')],
    env: buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: tempUserData }),
  });

  const window = await app.firstWindow();
  let hasErrors = false;
  window.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[Browser Console Error] ${msg.text()}`);
      hasErrors = true;
    } else {
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    }
  });
  window.on('pageerror', (error) => {
    console.error(`[Browser Error]: ${error.message}`);
    hasErrors = true;
  });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);

  console.log('App launched. Scanning folder...');
  await window.evaluate((targetFixturePath) => window.polytray.scanFolder(targetFixturePath), fixtureDir);

  await window.waitForTimeout(4000);

  const scrollInfo = await window.evaluate(() => {
    const grid = document.getElementById('file-grid');
    if (!grid) return null;
    return {
      scrollHeight: grid.scrollHeight,
      clientHeight: grid.clientHeight,
      overflowY: window.getComputedStyle(grid).overflowY,
      flex: window.getComputedStyle(grid).flex,
    };
  });
  console.log('Scroll Info:', scrollInfo);

  const thumbCount = await window.locator('.card-thumbnail img').count();
  console.log(`Thumbnails loaded: ${thumbCount}`);

  console.log('Opening preview panel...');
  await window.locator('.file-card').first().click();
  await window.waitForTimeout(2000);

  await window.screenshot({
    path: path.join(__dirname, 'preview-screenshot.png'),
  });
  console.log('Screenshot saved to preview-screenshot.png');

  console.log('Clicking Rescan...');
  await window.locator('#btn-rescan').click();
  const progressClasses = await window.locator('#scan-progress').getAttribute('class');
  console.log(`Scan Progress classes during rescan: ${progressClasses}`);

  await window.waitForTimeout(2000);

  const loadErrorStatus = await window.evaluate(() => {
    const errorEl = document.querySelector('#viewer-loading span');
    return errorEl ? errorEl.innerText : '';
  });
  if (loadErrorStatus.includes('Failed')) {
    console.error('UI indicates model failed to load:', loadErrorStatus);
    hasErrors = true;
  }

  await app.close();
  fs.rmSync(tempUserData, { recursive: true, force: true });
  console.log('Verification complete.');

  if (hasErrors) {
    console.error('TEST FAILED: Browser errors were encountered.');
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
