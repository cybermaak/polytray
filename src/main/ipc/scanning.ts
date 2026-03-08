/**
 * IPC handlers for folder scanning and thumbnail generation orchestration.
 */
import { BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import fs from "fs";
import { getDb, getSetting } from "../database";
import { scanFolder } from "../scanner";
import { extractMetadata } from "../metadata";
import { getThumbnailDir, queueThumbnailGeneration } from "../thumbnails";
import { FileRecord, ScannedFile, IPC } from "../../shared/types";

export function registerScanningHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  async function performScan(folderPath: string) {
    const db = getDb();
    const mainWindow = getMainWindow();
    const files = await scanFolder(folderPath);
    const total = files.length;

    const existingPaths = new Set(
      db
        .prepare("SELECT path FROM files WHERE directory LIKE ?")
        .all(folderPath + "%")
        .map((r) => (r as { path: string }).path),
    );

    // ── Pass 1: Index files quickly (metadata only, no thumbnails) ──
    const filesToThumbnail: ScannedFile[] = [];
    const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

    for (let i = 0; i < files.length; i++) {
      if (i % 50 === 0) {
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

      let meta = { vertexCount: 0, faceCount: 0 };
      try {
        meta = await extractMetadata(file.path, file.ext);
      } catch (e: unknown) {
        console.warn(
          `Failed to extract metadata for ${file.path}:`,
          (e as Error).message,
        );
      }

      db.prepare(
        `INSERT OR REPLACE INTO files (path, name, extension, directory, size_bytes, modified_at, vertex_count, face_count, thumbnail, thumbnail_failed, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        file.path,
        file.name,
        file.ext,
        file.dir,
        file.size,
        file.mtime,
        meta.vertexCount,
        meta.faceCount,
        null, // thumbnail will be generated in pass 2
        0, // thumbnail_failed
        Date.now(),
      );

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
    queueThumbnailGeneration(folderPath, getMainWindow);

    return { totalFiles: total };
  }

  ipcMain.handle(IPC.SCAN_FOLDER, async (event, folderPath) => {
    return performScan(folderPath);
  });

  ipcMain.handle(IPC.REFRESH_FOLDER_THUMBNAILS, async (event, folderPath) => {
    const db = getDb();
    // Reset flags for matched prefix
    db.prepare("UPDATE files SET thumbnail = null, thumbnail_failed = 0 WHERE path LIKE ?").run(`${folderPath}%`);
    queueThumbnailGeneration(folderPath, getMainWindow);
  });

  ipcMain.handle(IPC.SCAN_ALL_LIBRARY, async () => {
    const folders = getSetting<string[]>("library_folders", []);
    for (const folder of folders) {
      await performScan(folder);
    }
    return folders;
  });

  ipcMain.handle(IPC.CLEAR_THUMBNAILS, async () => {
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
    queueThumbnailGeneration(null, getMainWindow);
    return true;
  });
}


