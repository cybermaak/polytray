const { spawnSync } = require('node:child_process');

if (process.env.POLYTRAY_SKIP_INSTALL_APP_DEPS === '1') {
  console.log('[postinstall] Skipping electron-builder install-app-deps');
  process.exit(0);
}

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', 'install-app-deps'],
  { stdio: 'inherit', env: process.env },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
