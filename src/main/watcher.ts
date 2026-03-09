import { utilityProcess, UtilityProcess } from "electron";
import path from "path";
import fs from "fs";
import { BrowserWindow } from "electron";
import { Database } from "better-sqlite3";
import { extractMetadata } from "./metadata";
import { generateThumbnail } from "./thumbnails";
import { EXT_SET, IPC } from "../shared/types";
import { getSetting } from "./database";

let workerProcess: UtilityProcess | null = null;

/**
 * Starts watching a folder for 3D file changes using a background Utility process.
 */
export async function startWatcher(
  folderPaths: string[],
  mainWindow: BrowserWindow,
  db: Database,
) {
  await stopWatcher();

  if (folderPaths.length === 0) return;

  const workerPath = path.join(__dirname, "worker.js");
  workerProcess = utilityProcess.fork(workerPath);

  const watcherStability = getSetting<number>("watcher_stability", 1000);
  workerProcess.postMessage({ type: "start", folderPaths, watcherStability });

  workerProcess.on("message", (msg) => {
    if (msg.type === "add" || msg.type === "change") {
      handleFileChange(msg.filePath, msg.type, mainWindow, db);
    } else if (msg.type === "unlink") {
      handleFileRemove(msg.filePath, mainWindow, db);
    }
  });

  workerProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`Watcher worker exited suspiciously with code ${code}`);
    }
    workerProcess = null;
  });
}

/**
 * Gracefully stops the watcher worker process, with a timeout fallback.
 */
export async function stopWatcher(): Promise<void> {
  if (!workerProcess) return;

  const processToStop = workerProcess;
  workerProcess = null; // Prevent new messages/interaction immediately

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("Watcher: Stop timeout reached, force killing...");
      processToStop.kill();
      resolve();
    }, 2000);

    processToStop.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    processToStop.postMessage({ type: "stop" });
  });
}

async function handleFileChange(
  filePath: string,
  eventType: string,
  mainWindow: BrowserWindow,
  db: Database,
) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!EXT_SET.has(ext)) return;

  try {
    const stat = await fs.promises.stat(filePath);
    const name = path.basename(filePath, "." + ext);
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
      thumbnailPath = await generateThumbnail(filePath, ext);
      if (!thumbnailPath) thumbnailFailed = 1;
    } catch (e: unknown) {
      console.warn(
        `Watcher: Failed to generate thumbnail for ${filePath}:`,
        (e as Error).message,
      );
      thumbnailFailed = 1;
    }

    db.prepare(
      `
      INSERT INTO files (path, name, extension, directory, size_bytes, modified_at, vertex_count, face_count, thumbnail, thumbnail_failed, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at,
        vertex_count = excluded.vertex_count,
        face_count = excluded.face_count,
        thumbnail = CASE 
          WHEN excluded.modified_at >= files.modified_at OR files.thumbnail IS NULL THEN excluded.thumbnail 
          ELSE files.thumbnail 
        END,
        thumbnail_failed = CASE 
          WHEN excluded.modified_at >= files.modified_at OR files.thumbnail IS NULL THEN excluded.thumbnail_failed 
          ELSE files.thumbnail_failed 
        END,
        indexed_at = excluded.indexed_at
    `,
    ).run(
      filePath,
      name,
      ext,
      dir,
      stat.size,
      Math.floor(stat.mtimeMs),
      meta.vertexCount,
      meta.faceCount,
      thumbnailPath,
      thumbnailFailed,
      Date.now(),
    );

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

  db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
  mainWindow.webContents.send(IPC.FILES_UPDATED, { type: "unlink", filePath });
}
