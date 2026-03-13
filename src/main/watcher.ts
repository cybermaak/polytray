import { utilityProcess, UtilityProcess } from 'electron';
import path from 'path';
import fs from 'fs';
import { BrowserWindow } from 'electron';
import { Database } from 'better-sqlite3';
import { extractMetadata } from './metadata';
import { scheduleSingleThumbnailGeneration } from './thumbnails';
import { EXT_SET, IPC, RuntimeSettingsData } from '../shared/types';
import { createWatcherLifecycleManager } from './watcherLifecycle';
import { applyWatchedFileRecord } from './fileIndexing';

const watcherLifecycle = createWatcherLifecycleManager<UtilityProcess>({
  createProcess: () => {
    const workerPath = path.join(__dirname, 'worker.js');
    return utilityProcess.fork(workerPath);
  },
});

export async function startWatcher(
  folderPaths: string[],
  mainWindow: BrowserWindow,
  db: Database,
  settings: RuntimeSettingsData,
) {
  if (folderPaths.length === 0) {
    await stopWatcher();
    return;
  }

  await watcherLifecycle.restart(
    {
      folderPaths,
      watcherStability: settings.watcher_stability,
    },
    {
      onMessage: (msg) => {
        const data = msg as { type?: string; filePath?: string };
        if (!data.type || !data.filePath) return;

        if (data.type === 'add' || data.type === 'change') {
          void handleFileChange(data.filePath, data.type, mainWindow, db, settings);
        } else if (data.type === 'unlink') {
          handleFileRemove(data.filePath, mainWindow, db);
        }
      },
      onExit: (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`Watcher worker exited suspiciously with code ${code}`);
        }
      },
    },
  );
}

export async function stopWatcher(): Promise<void> {
  await watcherLifecycle.stop();
}

async function handleFileChange(
  filePath: string,
  eventType: string,
  mainWindow: BrowserWindow,
  db: Database,
  settings: RuntimeSettingsData,
) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!EXT_SET.has(ext)) return;

  try {
    const stat = await fs.promises.stat(filePath);
    const name = path.basename(filePath, '.' + ext);
    const dir = path.dirname(filePath);

    let meta = { vertexCount: 0, faceCount: 0 };
    try {
      meta = await extractMetadata(filePath, ext);
    } catch (e: unknown) {
      console.warn(
        `Watcher: Failed to extract metadata for ${filePath}:`,
        (e as Error).message,
      );
    }

    let thumbnailPath: string | null = null;
    let thumbnailFailed = 0;
    try {
      thumbnailPath = await scheduleSingleThumbnailGeneration(
        filePath,
        ext,
        settings,
        'watch',
      );
      if (!thumbnailPath) thumbnailFailed = 1;
    } catch (e: unknown) {
      console.warn(
        `Watcher: Failed to generate thumbnail for ${filePath}:`,
        (e as Error).message,
      );
      thumbnailFailed = 1;
    }

    applyWatchedFileRecord(db, {
      path: filePath,
      name,
      ext,
      dir,
      size: stat.size,
      modifiedAt: Math.floor(stat.mtimeMs),
      vertexCount: meta.vertexCount,
      faceCount: meta.faceCount,
      thumbnailPath,
      thumbnailFailed,
      indexedAt: Date.now(),
    });

    mainWindow.webContents.send(IPC.FILES_UPDATED, {
      type: eventType,
      filePath,
    });
  } catch (e: unknown) {
    console.warn(
      `Watcher: Failed to handle file change for ${filePath}:`,
      (e as Error).message,
    );
  }
}

function handleFileRemove(
  filePath: string,
  mainWindow: BrowserWindow,
  db: Database,
) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!EXT_SET.has(ext)) return;

  db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  mainWindow.webContents.send(IPC.FILES_UPDATED, { type: 'unlink', filePath });
}
