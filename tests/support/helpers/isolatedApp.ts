import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, ElectronApplication, type Page } from 'playwright';
import { buildElectronLaunchArgs, buildElectronLaunchEnv } from './electronLaunch';

export interface IsolatedAppOptions {
  mainEntry: string;
  scratchParent?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  beforeLaunch?: (paths: { ownerDir: string; userDataDir: string; scratchDir: string }) => void | Promise<void>;
}
export interface IsolatedApp {
  app: ElectronApplication;
  userDataDir: string;
  scratchDir: string;
  close(): Promise<void>;
}

/** Select the visible app UI after the first Electron page appears; hidden renderers may load first. */
export async function findMainWindow(app: ElectronApplication): Promise<Page> {
  await app.firstWindow();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const visible = await page.locator('#search-input').isVisible().catch(() => false);
      if (!visible) continue;
      const bridgeReady = await page.evaluate(() => typeof window.polytray?.getFiles === 'function').catch(() => false);
      if (bridgeReady) return page;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  const urls = app.windows().map(page => page.url());
  throw new Error(`Visible Polytray main window and bridge did not become ready; open page URLs: ${JSON.stringify(urls)}`);
}

/** Launch an app with private userData and diagnostics scratch. close() removes only its own directories. */
export async function launchIsolatedApp(options: IsolatedAppOptions): Promise<IsolatedApp> {
  const scratchParent = options.scratchParent ?? os.tmpdir();
  const ownerDir = fs.mkdtempSync(path.join(scratchParent, 'polytray-isolated-'));
  const userDataDir = path.join(ownerDir, 'user-data');
  const scratchDir = path.join(ownerDir, 'scratch');
  fs.mkdirSync(userDataDir); fs.mkdirSync(scratchDir);
  try { await options.beforeLaunch?.({ ownerDir, userDataDir, scratchDir }); }
  catch (error) { fs.rmSync(ownerDir, { recursive: true, force: true }); throw error; }
  const args = buildElectronLaunchArgs(options.mainEntry, userDataDir, options.args ?? []);
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
  let app: ElectronApplication;
  try {
    const mergedEnv = buildElectronLaunchEnv(process.env, {
      ...options.env, ELECTRON_USER_DATA: userDataDir, POLYTRAY_PERF_SCRATCH: scratchDir,
      POLYTRAY_ISOLATED_TEST: '1',
    });
    const env = Object.fromEntries(Object.entries(mergedEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    app = await electron.launch({ args, env });
  } catch (error) {
    fs.rmSync(ownerDir, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  return { app, userDataDir, scratchDir, async close() {
    if (closed) return;
    closed = true;
    try { await app.close(); } finally { fs.rmSync(ownerDir, { recursive: true, force: true }); }
  } };
}

/** For handoff tests: capture the arguments without invoking a platform application. */
export function createMockNativeLauncher() {
  const calls: Array<{ executable: string; args: string[] }> = [];
  return { calls, launch(executable: string, args: string[]) { calls.push({ executable, args: [...args] }); } };
}
