/**
 * IPC handlers for thumbnail loading and on-demand generation.
 */
import { BrowserWindow, ipcMain } from "electron";
import { getDb } from "../database";
import {
  getThumbnailDir,
  scheduleSingleThumbnailGeneration,
} from "../thumbnails";
import fs from "fs";
import { IPC } from "../../shared/types";
import { DEFAULT_APP_SETTINGS, toRuntimeSettings } from "../../shared/settings";
import { isPathContained } from "../pathContainment";
import { createFileIndexRepository } from "../fileIndexing";
import { createThumbnailIdentity } from "../thumbnailIdentity";
import {
  parseExtension,
  parseFilePath,
  parseThumbnailPath,
  parseRuntimeSettings,
} from "./runtimeValidation";

export function registerThumbnailHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  ipcMain.handle(IPC.READ_THUMBNAIL, async (event, thumbnailPath) => {
    if (!thumbnailPath) return null;
    const parsedThumbnailPath = parseThumbnailPath(thumbnailPath);

    // Security check: Ensure we only read from the dedicated thumbnail directory
    const thumbDir = getThumbnailDir();
    if (!isPathContained(thumbDir, parsedThumbnailPath)) {
      throw new Error("Access denied: Path is outside thumbnail directory");
    }

    try {
      const data = await fs.promises.readFile(parsedThumbnailPath);
      return `data:image/png;base64,${data.toString("base64")}`;
    } catch (_e) {
      return null;
    }
  });

  ipcMain.handle(IPC.GET_THUMBNAIL_PATH, (event, fileId) => {
    const db = getDb();
    const row = db
      .prepare("SELECT thumbnail FROM files WHERE id = ?")
      .get(fileId) as { thumbnail: string | null } | undefined;
    return row ? row.thumbnail : null;
  });

  ipcMain.handle(
    IPC.REQUEST_THUMBNAIL_GENERATION,
    async (event, filePath, ext, settings) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return null;
      const thumbnailPath = await scheduleSingleThumbnailGeneration(
        parseFilePath(filePath),
        parseExtension(ext),
        settings
          ? parseRuntimeSettings(settings)
          : toRuntimeSettings(DEFAULT_APP_SETTINGS),
        "manual",
      );
      const db = getDb();
      const repository = createFileIndexRepository(db);
      const current = repository.getFileIdentityByPath(filePath);
      if (!current) return null;
      if (thumbnailPath) {
        const update = repository.updateThumbnailState({ fileId: current.id, expectedContentRevision: current.contentRevision, thumbnailPath, thumbnailFailed: 0 });
        if (update.status === "updated") {
          const normalizedSettings = settings ? parseRuntimeSettings(settings) : toRuntimeSettings(DEFAULT_APP_SETTINGS);
          const { identity } = createThumbnailIdentity(current.path, current.contentRevision, normalizedSettings.thumbnailColor, Number(normalizedSettings.thumbQuality ?? 256) as 128 | 256 | 512);
          const target = getMainWindow();
          if (target && !target.isDestroyed()) target.webContents.send(IPC.THUMBNAIL_READY, { fileId: current.id, thumbnailPath, identity, contentRevision: current.contentRevision });
        }
      } else {
        repository.updateThumbnailState({ fileId: current.id, expectedContentRevision: current.contentRevision, thumbnailPath: null, thumbnailFailed: 1 });
      }
      return thumbnailPath;
    },
  );
}
