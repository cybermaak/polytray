// `npm rebuild better-sqlite3` can install a Node-ABI prebuilt binary without touching the
// `.forge-meta` marker @electron/rebuild left from an earlier Electron rebuild. The marker then
// still claims the Electron ABI, so the next `electron-builder install-app-deps` skips the module
// and E2E launches Electron against the Node binary (NODE_MODULE_VERSION mismatch). Removing the
// marker after every Node rebuild forces the Electron rebuild to run.
const fs = require('node:fs');
const path = require('node:path');

const marker = path.join(__dirname, '../../node_modules/better-sqlite3/build/Release/.forge-meta');
fs.rmSync(marker, { force: true });
