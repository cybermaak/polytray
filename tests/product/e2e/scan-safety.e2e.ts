const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildElectronLaunchEnv } = require('../../support/helpers/electronLaunch');

test('unavailable root retains annotated row and an available empty root prunes it', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-safety-user-'));
  const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-safety-library-'));
  const modelPath = path.join(libraryRoot, 'kept.stl');
  fs.writeFileSync(modelPath, 'solid kept\nendsolid kept\n');
  let app;
  try {
    const args = [path.join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`];
    if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
    app = await electron.launch({ args, env: buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: userData }) });
    const window = await app.firstWindow();
    const scan = (target: string) => window.evaluate((folder) => window.polytray.scanFolder(folder), target);
    await scan(libraryRoot);
    let record = await window.evaluate(async (target) => {
      const result = await window.polytray.getFiles({ limit: 100, offset: 0 });
      return result.files.find((file) => file.path === target);
    }, modelPath);
    expect(record).toBeTruthy();
    await window.evaluate(({ id }) => window.polytray.updateFileMetadata({ id, tags: ['kept-tag'], notes: 'kept note' }), { id: record.id });

    fs.rmSync(libraryRoot, { recursive: true, force: true });
    const unavailable = await scan(libraryRoot);
    expect(unavailable.state).toBe('failed');
    record = await window.evaluate(async (id) => window.polytray.getFileById(id), record.id);
    expect(record.tags).toBe('["kept-tag"]');
    expect(record.notes).toBe('kept note');

    fs.mkdirSync(libraryRoot);
    const empty = await scan(libraryRoot);
    expect(empty.state).toBe('completed');
    expect(await window.evaluate(async (id) => window.polytray.getFileById(id), record.id)).toBeFalsy();
  } finally {
    if (app) await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(libraryRoot, { recursive: true, force: true });
  }
});
