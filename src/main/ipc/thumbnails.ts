/**
 * IPC handlers for thumbnail loading and on-demand generation.
 */
import { BrowserWindow, ipcMain } from "electron";
import { getDb } from "../database";
import { generateThumbnail, getThumbnailDir } from "../thumbnails";
import fs from "fs";
import { IPC } from "../../shared/types";

export function registerThumbnailHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  ipcMain.handle(IPC.READ_THUMBNAIL, async (event, thumbnailPath) => {
    if (!thumbnailPath) return null;

    // Security check: Ensure we only read from the dedicated thumbnail directory
    const thumbDir = getThumbnailDir();
    if (!thumbnailPath.startsWith(thumbDir)) {
      throw new Error("Access denied: Path is outside thumbnail directory");
    }

    try {
      const data = await fs.promises.readFile(thumbnailPath);
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
    async (event, filePath, ext) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return null;
      const thumbnailPath = await generateThumbnail(filePath, ext);
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
