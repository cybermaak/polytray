/* eslint-env node */
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName === 'darwin') {
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
