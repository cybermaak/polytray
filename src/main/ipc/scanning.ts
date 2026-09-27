/**
 * IPC handlers for folder scanning and thumbnail generation orchestration.
 */
import { BrowserWindow, ipcMain } from "electron";
import { getDb, getSetting } from "../database";
import {
  invalidateThumbnails,
  queueThumbnailGeneration,
} from "../thumbnails";
import {
  IPC,
  RuntimeSettingsData,
} from "../../shared/types";
import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import { createScanService } from "../scanService";
import { MetadataWorkerClient } from "../metadataWorkerClient";
import { parseFolderPath, parseRuntimeSettings } from "./runtimeValidation";

export function registerScanningHandlers(
  getMainWindow: () => BrowserWindow | null,
  metadataWorker = new MetadataWorkerClient({ maxQueuedRequests: 2 }),
) {
  const scanService = createScanService({
    db: getDb(),
    extractMetadata: (filePath, extension, context) => metadataWorker.extract({
      requestId: context.requestId, fileId: context.identity.id,
      contentRevision: context.identity.contentRevision, filePath, extension,
    }, { signal: context.signal }),
    onProgress: (progress) => {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.SCAN_PROGRESS, progress);
    },
    onFileIndexed: (filePath, current, total) => {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.FILE_INDEXED, { path: filePath, current, total });
      }
    },
  });

  async function performScan(
    folderPath: string,
    settings: RuntimeSettingsData = {
      thumbnail_timeout: DEFAULT_APP_SETTINGS.thumbnail_timeout,
      scanning_batch_size: DEFAULT_APP_SETTINGS.scanning_batch_size,
      watcher_stability: DEFAULT_APP_SETTINGS.watcher_stability,
      page_size: DEFAULT_APP_SETTINGS.page_size,
      thumbnailColor: DEFAULT_APP_SETTINGS.thumbnailColor,
    },
  ) {
    const mainWindow = getMainWindow();
    const result = await scanService.scan(folderPath, { batchSize: settings.scanning_batch_size });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_COMPLETE, {
        totalFiles: result.totalFiles,
        state: result.state,
        affectedScopes: result.affectedScopes,
        retainedCount: result.retainedCount,
        jobId: result.jobId,
        discovered: result.discovered,
        indexed: result.indexed,
        metadataCompleted: result.metadataCompleted,
        metadataFailed: result.metadataFailed,
      });
    }

    // ── Pass 2: Generate thumbnails in the background (fire-and-forget) ──
    queueThumbnailGeneration(folderPath, getMainWindow, settings);

    return result;
  }

  ipcMain.handle(IPC.SCAN_FOLDER, async (event, folderPath, settings: RuntimeSettingsData) => {
    return performScan(
      parseFolderPath(folderPath),
      settings ? parseRuntimeSettings(settings) : undefined,
    );
  });

  ipcMain.handle(IPC.REFRESH_FOLDER_THUMBNAILS, async (event, folderPath, settings: RuntimeSettingsData) => {
    const parsedFolderPath = parseFolderPath(folderPath);
    const parsedSettings = settings ? parseRuntimeSettings(settings) : {
      thumbnail_timeout: DEFAULT_APP_SETTINGS.thumbnail_timeout,
      scanning_batch_size: DEFAULT_APP_SETTINGS.scanning_batch_size,
      watcher_stability: DEFAULT_APP_SETTINGS.watcher_stability,
      page_size: DEFAULT_APP_SETTINGS.page_size,
      thumbnailColor: DEFAULT_APP_SETTINGS.thumbnailColor,
    };
    await invalidateThumbnails({ kind: "folder", folderPath: parsedFolderPath }, parsedSettings, getMainWindow);
  });

  ipcMain.handle(
    IPC.SCAN_ALL_LIBRARY,
    async (
      event,
      folders: string[] = getSetting<string[]>("library_folders", []),
      settings?: RuntimeSettingsData,
    ) => {
    for (const folder of folders.map((entry) => parseFolderPath(entry))) {
      await performScan(folder, settings ? parseRuntimeSettings(settings) : undefined);
    }
    return folders;
  });

  ipcMain.handle(IPC.CLEAR_THUMBNAILS, async (event, settings?: RuntimeSettingsData) => {
    const parsedSettings = settings ? parseRuntimeSettings(settings) : {
      thumbnail_timeout: DEFAULT_APP_SETTINGS.thumbnail_timeout,
      scanning_batch_size: DEFAULT_APP_SETTINGS.scanning_batch_size,
      watcher_stability: DEFAULT_APP_SETTINGS.watcher_stability,
      page_size: DEFAULT_APP_SETTINGS.page_size,
      thumbnailColor: DEFAULT_APP_SETTINGS.thumbnailColor,
    };
    await invalidateThumbnails({ kind: "all" }, parsedSettings, getMainWindow);
    return true;
  });

  return { dispose: async () => { await scanService.dispose(); await metadataWorker.shutdown(); } };
}
