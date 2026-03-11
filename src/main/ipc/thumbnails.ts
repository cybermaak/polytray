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
      if (thumbnailPath) {
        db.prepare(
          "UPDATE files SET thumbnail = ?, thumbnail_failed = 0 WHERE path = ?",
        ).run(thumbnailPath, filePath);
      } else {
        db.prepare("UPDATE files SET thumbnail_failed = 1 WHERE path = ?").run(
          filePath,
        );
      }
      return thumbnailPath;
    },
  );
}
