/**
 * IPC handlers for folder scanning and thumbnail generation orchestration.
 */
import { BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import fs from "fs";
import { getDb, getSetting } from "../database";
import { scanFolder } from "../scanner";
import { extractMetadata, type MetadataSummary } from "../metadata";
import {
  cancelPendingThumbnailJobs,
  getThumbnailDir,
  queueThumbnailGeneration,
} from "../thumbnails";
import {
  FileRecord,
  IPC,
  RuntimeSettingsData,
  ScannedFile,
} from "../../shared/types";
import { filterContainedPaths } from "../pathContainment";
import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import { applyScannedFileRecord } from "../fileIndexing";
import { parseFolderPath, parseRuntimeSettings } from "./runtimeValidation";

export function registerScanningHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
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
    const db = getDb();
    const mainWindow = getMainWindow();
    const files = await scanFolder(folderPath);
    const total = files.length;

    const existingRows = db.prepare("SELECT path FROM files").all() as Array<{
      path: string;
    }>;
    const existingPaths = new Set(
      filterContainedPaths(
        folderPath,
        existingRows.map((row) => row.path),
      ),
    );

    // ── Pass 1: Index files quickly (metadata only, no thumbnails) ──
    const filesToThumbnail: ScannedFile[] = [];
    const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

    const batchSize = settings.scanning_batch_size;
    for (let i = 0; i < files.length; i++) {
      if (i % batchSize === 0) {
        await yieldToEventLoop(); // Crucial: don't beachball macOS on 10,000 files
      }
      
      const file = files[i];
      existingPaths.delete(file.path);

      const existing = db
        .prepare(
          "SELECT modified_at, size_bytes, thumbnail, thumbnail_failed FROM files WHERE path = ?",
        )
        .get(file.path) as
        | Pick<
            FileRecord,
            "modified_at" | "size_bytes" | "thumbnail" | "thumbnail_failed"
          >
        | undefined;
      if (
        existing &&
        existing.modified_at === file.mtime &&
        existing.size_bytes === file.size
      ) {
        // Already up to date — skip but mark for thumbnail if missing and hasn't failed previously
        if (!existing.thumbnail && !existing.thumbnail_failed) {
          filesToThumbnail.push(file);
        }
        if (mainWindow) {
          mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
            current: i + 1,
            total,
            filename: file.name,
            skipped: true,
          });
        }
        continue;
      }

      let meta: MetadataSummary = {
        vertexCount: 0,
        faceCount: 0,
        dimensions: null,
      };
      try {
        meta = await extractMetadata(file.path, file.ext);
      } catch (e: unknown) {
        console.warn(
          `Failed to extract metadata for ${file.path}:`,
          (e as Error).message,
        );
      }

      applyScannedFileRecord(db, {
        path: file.path,
        name: file.name,
        ext: file.ext,
        dir: file.dir,
        size: file.size,
        mtime: file.mtime,
        vertexCount: meta.vertexCount,
        faceCount: meta.faceCount,
        dimensions: meta.dimensions,
        indexedAt: Date.now(),
      });

      filesToThumbnail.push(file);

      if (mainWindow) {
        mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
          current: i + 1,
          total,
          filename: file.name,
          skipped: false,
        });
      }

      // Emit file-indexed so the renderer can show the card immediately
      if (mainWindow) {
        mainWindow.webContents.send(IPC.FILE_INDEXED, {
          path: file.path,
          current: i + 1,
          total,
        });
      }
    }

    for (const stalePath of existingPaths) {
      db.prepare("DELETE FROM files WHERE path = ?").run(stalePath);
    }

    // Notify scan complete (cards are all visible now)
    if (mainWindow) {
      mainWindow.webContents.send(IPC.SCAN_COMPLETE, { totalFiles: total });
    }

    // ── Pass 2: Generate thumbnails in the background (fire-and-forget) ──
    queueThumbnailGeneration(folderPath, getMainWindow, settings);

    return { totalFiles: total };
  }

  ipcMain.handle(IPC.SCAN_FOLDER, async (event, folderPath, settings: RuntimeSettingsData) => {
    return performScan(
      parseFolderPath(folderPath),
      settings ? parseRuntimeSettings(settings) : undefined,
    );
  });

  ipcMain.handle(IPC.REFRESH_FOLDER_THUMBNAILS, async (event, folderPath, settings: RuntimeSettingsData) => {
    const parsedFolderPath = parseFolderPath(folderPath);
    const parsedSettings = settings ? parseRuntimeSettings(settings) : undefined;
    cancelPendingThumbnailJobs((job) =>
      filterContainedPaths(parsedFolderPath, [job.filePath]).length > 0,
    );
    const db = getDb();
    const rows = db.prepare("SELECT path FROM files").all() as Array<{ path: string }>;
    const containedPaths = filterContainedPaths(
      parsedFolderPath,
      rows.map((row) => row.path),
    );
    const resetThumbs = db.transaction((paths: string[]) => {
      const stmt = db.prepare(
        "UPDATE files SET thumbnail = null, thumbnail_failed = 0 WHERE path = ?",
      );
      for (const filePath of paths) {
        stmt.run(filePath);
      }
    });
    resetThumbs(containedPaths);
    queueThumbnailGeneration(parsedFolderPath, getMainWindow, parsedSettings ?? {
      thumbnail_timeout: DEFAULT_APP_SETTINGS.thumbnail_timeout,
      scanning_batch_size: DEFAULT_APP_SETTINGS.scanning_batch_size,
      watcher_stability: DEFAULT_APP_SETTINGS.watcher_stability,
      page_size: DEFAULT_APP_SETTINGS.page_size,
      thumbnailColor: DEFAULT_APP_SETTINGS.thumbnailColor,
    });
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
    cancelPendingThumbnailJobs();
    const db = getDb();
    const thumbDir = getThumbnailDir();
    try {
      const files = await fs.promises.readdir(thumbDir);
      await Promise.all(
        files
          .filter((file) => file.endsWith(".png"))
          .map((file) => fs.promises.unlink(join(thumbDir, file))),
      );
    } catch {
      // Directory may not exist yet
    }
    db.prepare("UPDATE files SET thumbnail = null, thumbnail_failed = 0").run();
    queueThumbnailGeneration(
      null,
      getMainWindow,
      parsedSettings,
    );
    return true;
  });
}
