import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
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

/** Stop only this isolated app, then remove only its private owner after exit is confirmed. */
export async function cleanupTimedOutIsolatedApp(
  appProcess: ChildProcess,
  ownerDir: string,
  options: {
    termWaitMs?: number;
    killWaitMs?: number;
    removeOwnedDir?: (directory: string) => void;
  } = {},
) {
  if (!path.basename(path.resolve(ownerDir)).startsWith('polytray-isolated-')) {
    throw new Error('Refusing cleanup outside an isolated owner directory');
  }
  const hasExited = () => Number.isInteger(appProcess.exitCode) || typeof appProcess.signalCode === 'string';
  const waitForExit = (timeoutMs: number) => {
    if (hasExited()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        appProcess.removeListener('exit', onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      appProcess.once('exit', onExit);
      timer = setTimeout(() => finish(hasExited()), timeoutMs);
      if (hasExited()) finish(true);
    });
  };
  if (!hasExited()) {
    appProcess.kill('SIGTERM');
    if (!(await waitForExit(options.termWaitMs ?? 500))) {
      appProcess.kill('SIGKILL');
      if (!(await waitForExit(options.killWaitMs ?? 5_000))) {
        throw new Error('Isolated Electron process did not exit; private scratch was retained');
      }
    }
  }
  (options.removeOwnedDir ?? ((directory) => fs.rmSync(directory, {
    recursive: true, force: true, maxRetries: 20, retryDelay: 100,
  })))(ownerDir);
}

/** Close an isolated app, recovering a timeout or rejection through its exact owned process. */
export async function closeIsolatedAppWithFallback(
  isolated: Pick<IsolatedApp, 'app' | 'userDataDir' | 'close'>,
  options: {
    closeWaitMs?: number;
    termWaitMs?: number;
    killWaitMs?: number;
    removeOwnedDir?: (directory: string) => void;
  } = {},
) {
  // Playwright invalidates ElectronApplication.process() once app.close() settles.
  const appProcess = isolated.app.process();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closeError: unknown;
  let closed = false;
  try {
    closed = await Promise.race([
      isolated.close().then(() => true),
      new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), options.closeWaitMs ?? 5_000); }),
    ]);
  } catch (error) { closeError = error; }
  finally { if (timeout) clearTimeout(timeout); }
  if (closed) return;

  try {
    await cleanupTimedOutIsolatedApp(appProcess, path.dirname(isolated.userDataDir), options);
  } catch (fallbackError) {
    if (closeError) throw new AggregateError([closeError, fallbackError], 'Isolated app close and fallback cleanup failed');
    throw fallbackError;
  }
  if (closeError) console.error('Isolated app close failed; owned-process cleanup recovered:', closeError);
}

/** Keep an earlier test failure authoritative while reporting a separate cleanup error. */
export async function cleanupPreservingPrimaryFailure(
  primaryFailed: boolean,
  cleanup: () => Promise<void>,
  reportCleanupError: (error: unknown) => void | Promise<void>,
) {
  try { await cleanup(); }
  catch (error) {
    if (!primaryFailed) throw error;
    try { await reportCleanupError(error); }
    catch (reportError) { console.error('Could not report isolated app cleanup error:', reportError); }
  }
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
  const appProcess = app.process();
  return { app, userDataDir, scratchDir, async close() {
    if (closed) return;
    closed = true;
    await app.close();
    await cleanupTimedOutIsolatedApp(appProcess, ownerDir);
  } };
}

/** For handoff tests: capture the arguments without invoking a platform application. */
export function createMockNativeLauncher() {
  const calls: Array<{ executable: string; args: string[] }> = [];
  return { calls, launch(executable: string, args: string[]) { calls.push({ executable, args: [...args] }); } };
}
