import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { ElectronApplication } from 'playwright';

/** Record quit phases without changing or skipping Electron's awaited shutdown. */
export async function installShutdownEvidence(app: ElectronApplication, outputPath: string, userDataDir?: string) {
  const recordHost = (entry: Record<string, unknown>) => {
    try { fs.appendFileSync(outputPath, `${JSON.stringify({ ...entry, at: Date.now() })}\n`); }
    catch { /* Diagnostics cannot alter app shutdown. */ }
  };
  try { await app.evaluate((electron, targetPath) => {
    const localFs = process.getBuiltinModule('fs');
    if (!localFs) return;
    const record = (stage: string) => {
      let snapshot: unknown;
      try {
        snapshot = {
          mainPid: process.pid,
          windows: electron.BrowserWindow.getAllWindows().map((window) => ({
            id: window.id,
            destroyed: window.isDestroyed(),
            url: window.webContents.isDestroyed() ? null : window.webContents.getURL(),
            rendererPid: window.webContents.isDestroyed() ? null : window.webContents.getOSProcessId(),
          })),
          processes: electron.app.getAppMetrics().map((metric) => ({
            pid: metric.pid, type: metric.type, serviceName: metric.serviceName,
          })),
        };
      } catch (error) { snapshot = { error: String(error) }; }
      try { localFs.appendFileSync(targetPath, `${JSON.stringify({ stage, at: Date.now(), snapshot })}\n`); }
      catch { /* Diagnostics cannot alter app shutdown. */ }
    };
    record('probe-installed');
    for (const stage of ['before-quit', 'window-all-closed', 'will-quit', 'quit'] as const) {
      electron.app.on(stage, () => record(stage));
    }
  }, outputPath); }
  catch (error) { recordHost({ stage: 'probe-install-failed', error: String(error) }); }

  return async (close: () => Promise<void>) => {
    let mainPid: number | null = null;
    try { mainPid = app.process().pid; }
    catch { /* The app may have exited before the probe was installed. */ }
    recordHost({ stage: 'close-called', mainPid });
    const timer = setTimeout(() => {
      let mainAlive: boolean | null = null;
      if (mainPid !== null) {
        try { process.kill(mainPid, 0); mainAlive = true; }
        catch (error) { mainAlive = (error as NodeJS.ErrnoException).code === 'EPERM'; }
      }
      recordHost({ stage: 'close-pending-5s', mainPid, mainAlive });
    }, 5_000);
    const processTreeTimer = setTimeout(() => {
      try {
        if (mainPid === null || process.platform === 'win32') return;
        const listing = spawnSync('ps', ['-eo', 'pid=,ppid=,stat=,etime=,command='], {
          encoding: 'utf8', timeout: 1_000, maxBuffer: 512 * 1024,
        });
        if (listing.error || listing.status !== 0) {
          recordHost({ stage: 'close-pending-10s', mainPid, processTreeError: String(listing.error ?? listing.stderr) });
          return;
        }
        const processes = listing.stdout.split('\n').flatMap((line) => {
          const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
          return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), state: match[3], elapsed: match[4], command: match[5] }] : [];
        });
        const descendants = new Set([mainPid]);
        for (let changed = true; changed;) {
          changed = false;
          for (const item of processes) {
            if (!descendants.has(item.ppid) || descendants.has(item.pid)) continue;
            descendants.add(item.pid);
            changed = true;
          }
        }
        recordHost({
          stage: 'close-pending-10s', mainPid,
          processTree: processes.filter((item) =>
            descendants.has(item.pid) || Boolean(userDataDir && item.command.includes(userDataDir))).slice(0, 48),
        });
      } catch (error) {
        recordHost({ stage: 'close-pending-10s', mainPid, processTreeError: String(error) });
      }
    }, 10_000);
    try { await close(); }
    finally {
      clearTimeout(timer);
      clearTimeout(processTreeTimer);
      recordHost({ stage: 'close-settled', mainPid });
    }
  };
}
