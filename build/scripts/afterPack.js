/* eslint-env node */
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName === 'darwin') {
    // When a real Developer ID signing identity is configured (local release
    // flow), electron-builder will codesign the app itself. Skip the adhoc
    // fallback so it does not interfere with Hardened Runtime / notarization.
    const realSigning = !!((context.packager.platformSpecificBuildOptions || {}).notarize)
      && process.env.POLYTRAY_SIGN_RELEASE === '1';
    if (realSigning) {
      console.log('[afterPack] Real Developer ID signing active — skipping adhoc fallback signature.');
      return;
    }
    const appOutDir = context.appOutDir;
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    console.log(`\n[afterPack] Forcing deep adhoc signature on ${appPath} to prevent 'Damaged App' Gatekeeper errors for unsigned GitHub binaries on Apple Silicon.`);
    try {
      execSync(`codesign -s - --force --deep "${appPath}"`, { stdio: 'inherit' });
      console.log(`[afterPack] Successfully generated deep adhoc signature.`);
    } catch (e) {
      console.warn(`[afterPack] Failed to force adhoc signature: ${e.message}`);
    }
  }
};
