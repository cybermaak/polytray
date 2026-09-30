/**
 * IPC handlers for thumbnail loading and on-demand generation.
 */
import { BrowserWindow, ipcMain } from "electron";
import { getDb } from "../database";
import {
  getThumbnailCacheEpoch,
  getThumbnailDir,
  readThumbnailCacheBytes,
  scheduleSingleThumbnailGeneration,
  waitForThumbnailCacheReady,
} from "../thumbnails";
import { IPC } from "../../shared/types";
import { DEFAULT_APP_SETTINGS, toRuntimeSettings } from "../../shared/settings";
import { isSafeThumbnailCacheFilePath } from "../localFileProtocol";
import { createFileIndexRepository } from "../fileIndexing";
import { createThumbnailIdentity, generateForCapturedThumbnailIdentity } from "../thumbnailIdentity";
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
    await waitForThumbnailCacheReady();
    const parsedThumbnailPath = parseThumbnailPath(thumbnailPath);

    // Security check: Ensure we only read from the dedicated thumbnail directory
    const thumbDir = getThumbnailDir();
    if (!isSafeThumbnailCacheFilePath(parsedThumbnailPath, thumbDir)) {
      throw new Error("Access denied: Path is outside thumbnail directory");
    }

    const data = await readThumbnailCacheBytes(parsedThumbnailPath);
    return data ? `data:image/png;base64,${data.toString("base64")}` : null;
  });

  ipcMain.handle(IPC.GET_THUMBNAIL_PATH, async (event, fileId) => {
    await waitForThumbnailCacheReady();
    const db = getDb();
    const row = db
      .prepare("SELECT thumbnail FROM files WHERE id = ?")
      .get(fileId) as { thumbnail: string | null } | undefined;
    return row ? row.thumbnail : null;
  });

  ipcMain.handle(
    IPC.REQUEST_THUMBNAIL_GENERATION,
    async (_event, filePath, ext, settings) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return null;
      const parsedFilePath = parseFilePath(filePath);
      const parsedExt = parseExtension(ext);
      const normalizedSettings = settings ? parseRuntimeSettings(settings) : toRuntimeSettings(DEFAULT_APP_SETTINGS);
      await waitForThumbnailCacheReady();
      const capturedCacheEpoch = getThumbnailCacheEpoch(parsedFilePath);
      const db = getDb();
      const repository = createFileIndexRepository(db);
      return generateForCapturedThumbnailIdentity(
        () => {
          const indexed = repository.getFileIdentityByPath(parsedFilePath);
          if (!indexed) return null;
          const row = db.prepare("SELECT thumbnail FROM files WHERE id = ?").get(indexed.id) as { thumbnail: string | null } | undefined;
          return row ? { ...indexed, thumbnailPath: row.thumbnail } : null;
        },
        () => scheduleSingleThumbnailGeneration(parsedFilePath, parsedExt, normalizedSettings, "manual"),
        (captured) => getThumbnailCacheEpoch(captured.path) === capturedCacheEpoch,
        (captured, thumbnailPath) => {
          const update = repository.updateThumbnailState({
            fileId: captured.id,
            expectedContentRevision: captured.contentRevision,
            thumbnailPath: thumbnailPath ?? captured.thumbnailPath,
            thumbnailFailed: thumbnailPath ? 0 : 1,
          });
          if (update.status !== "updated") return false;
          if (thumbnailPath) {
            const { identity } = createThumbnailIdentity(captured.path, captured.contentRevision, normalizedSettings.thumbnailColor, Number(normalizedSettings.thumbQuality ?? 256) as 128 | 256 | 512);
            const target = getMainWindow();
            if (target && !target.isDestroyed()) target.webContents.send(IPC.THUMBNAIL_READY, { fileId: captured.id, thumbnailPath, identity, contentRevision: captured.contentRevision });
          }
          return true;
        },
      );
    },
  );
}
