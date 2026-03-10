import { app, ipcMain, BrowserWindow } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import crypto from "crypto";
import { IPC, PreviewParseResultData, ScannedFile, SerializedMesh } from "../shared/types";
import { getThumbnailWindow } from "./index";
import { getDb, getSetting } from "./database";

let thumbnailDir: string | null = null;
const pendingRequests = new Map<string, Array<{ resolve: (val: string | null) => void }>>();
const inflightPromises = new Map<string, Promise<string | null>>();
const PREVIEW_PARSE_TIMEOUT_MS = 120000;
const pendingPreviewParses = new Map<
  string,
  {
    resolve: (meshes: SerializedMesh[]) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }
>();

export function getThumbnailDir(): string {
  if (!thumbnailDir) {
    thumbnailDir = path.join(app.getPath("userData"), "thumbnails");
    if (!fsSync.existsSync(thumbnailDir)) {
      fsSync.mkdirSync(thumbnailDir, { recursive: true });
    }
  }
  return thumbnailDir;
}

/**
 * Initializes the thumbnail service by setting up a global IPC listener.
 */
export function initThumbnailService() {
  ipcMain.on(IPC.THUMBNAIL_GENERATED, async (_event, result) => {
    const filePath = result.filePath;
    const callbacks = pendingRequests.get(filePath);
    if (!callbacks) return;

    pendingRequests.delete(filePath);
    inflightPromises.delete(filePath);

    let savedPath: string | null = null;

    if (result.success && result.dataUrl) {
      try {
        const thumbDir = getThumbnailDir();
        const hash = generatePathHash(filePath);
        const thumbPath = path.join(thumbDir, `${hash}.png`);

        const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, "");
        await fs.writeFile(thumbPath, Buffer.from(base64Data, "base64"));
        savedPath = thumbPath;
      } catch (e: unknown) {
        console.warn(`[Thumbnails] Failed to save ${filePath}:`, (e as Error).message);
      }
    }

    callbacks.forEach((cb) => cb.resolve(savedPath));
  });

  ipcMain.on(IPC.PREVIEW_PARSED, (_event, result: PreviewParseResultData) => {
    const pending = pendingPreviewParses.get(result.requestId);
    if (!pending) return;

    pendingPreviewParses.delete(result.requestId);
    clearTimeout(pending.timeoutId);

    if (result.success && result.meshes) {
      pending.resolve(result.meshes);
      return;
    }

    pending.reject(new Error(result.error || "Preview parse failed"));
  });

  ipcMain.handle(IPC.REQUEST_PREVIEW_PARSE, async (_event, filePath: string, ext: string) => {
    return requestPreviewParse(filePath, ext);
  });
}

function generatePathHash(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

async function requestPreviewParse(
  filePath: string,
  ext: string,
): Promise<SerializedMesh[]> {
  const thumbWindow = getThumbnailWindow();
  if (!thumbWindow || thumbWindow.isDestroyed()) {
    throw new Error("Background preview parser is unavailable");
  }

  const requestId = crypto.randomUUID();

  return new Promise<SerializedMesh[]>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingPreviewParses.delete(requestId);
      reject(new Error("Background preview parse timed out"));
    }, Math.max(getSetting<number>("thumbnail_timeout", 20000), PREVIEW_PARSE_TIMEOUT_MS));

    pendingPreviewParses.set(requestId, {
      resolve,
      reject,
      timeoutId,
    });

    thumbWindow.webContents.send(IPC.GENERATE_PREVIEW_PARSE_REQUEST, {
      requestId,
      filePath,
      ext,
    });
  });
}

/**
 * Generates a thumbnail for a 3D model file.
 */
export async function generateThumbnail(
  filePath: string,
  ext: string,
): Promise<string | null> {
  // 1. De-duplicate if already being processed
  const existing = inflightPromises.get(filePath);
  if (existing) return existing;

  const promise = (async () => {
    // 2. Check cache first
    const thumbDir = getThumbnailDir();
    const hash = generatePathHash(filePath);
    const thumbPath = path.join(thumbDir, `${hash}.png`);

    try {
      await fs.access(thumbPath);
      return thumbPath;
    } catch {
      // Not in cache, proceed to generate
    }

    const thumbWindow = getThumbnailWindow();
    if (!thumbWindow || thumbWindow.isDestroyed()) return null;

    return new Promise<string | null>((resolve) => {
      // Register callback handled by global listener
      const callbacks = pendingRequests.get(filePath) || [];
      callbacks.push({ resolve });
      pendingRequests.set(filePath, callbacks);

      // Send generation request
      thumbWindow.webContents.send(IPC.GENERATE_THUMBNAIL_REQUEST, {
        filePath,
        ext,
        thumbPath,
      });

      // Safety timeout
      const timeout = getSetting<number>("thumbnail_timeout", 20000);
      setTimeout(() => {
        const currentCallbacks = pendingRequests.get(filePath);
        if (currentCallbacks) {
          const index = currentCallbacks.findIndex((c) => c.resolve === resolve);
          if (index > -1) {
            currentCallbacks.splice(index, 1);
            if (currentCallbacks.length === 0) {
              pendingRequests.delete(filePath);
              inflightPromises.delete(filePath);
            }
            resolve(null);
          }
        }
      }, timeout);
    });
  })();

  inflightPromises.set(filePath, promise);
  return promise;
}

/**
 * Orchestrates background thumbnail generation for a list of files.
 */
export async function generateThumbnailsInBackground(
  filesToThumbnail: ScannedFile[],
  getMainWindow: () => BrowserWindow | null,
) {
  const db = getDb();
  const total = filesToThumbnail.length;
  if (total === 0) return;

  const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));
  const yieldForRenderer = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.THUMBNAIL_PROGRESS, {
      current: 0,
      total,
      filename: "",
      phase: "start",
    });
  }

  for (let i = 0; i < total; i++) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;

    const file = filesToThumbnail[i];
    await yieldToEventLoop();

    const startTime = Date.now();

    try {
      const thumbnailPath = await generateThumbnail(file.path, file.ext);
      if (thumbnailPath) {
        db.prepare("UPDATE files SET thumbnail = ?, thumbnail_failed = 0 WHERE path = ?").run(
          thumbnailPath,
          file.path,
        );
        const currentWin = getMainWindow();
        if (currentWin && !currentWin.isDestroyed()) {
          const row = db.prepare("SELECT id FROM files WHERE path = ?").get(file.path) as { id: number } | undefined;
          if (row) {
            currentWin.webContents.send(IPC.THUMBNAIL_READY, {
              fileId: row.id,
              thumbnailPath,
            });
          }
        }
      } else {
        db.prepare("UPDATE files SET thumbnail_failed = 1 WHERE path = ?").run(file.path);
      }
    } catch (e: unknown) {
      console.warn(`[Thumbnails] Failed ${file.path}:`, (e as Error).message);
    }

    const progressWin = getMainWindow();
    if (progressWin && !progressWin.isDestroyed()) {
      progressWin.webContents.send(IPC.THUMBNAIL_PROGRESS, {
        current: i + 1,
        total,
        filename: file.path,
        phase: "progress",
      });
    }

    const elapsed = Date.now() - startTime;
    await yieldForRenderer(elapsed > 500 ? 100 : 30);
  }

  const finalWin = getMainWindow();
  if (finalWin && !finalWin.isDestroyed()) {
    finalWin.webContents.send(IPC.THUMBNAIL_PROGRESS, {
      current: total,
      total,
      filename: "",
      phase: "done",
    });
  }
}

/**
 * Re-queues thumbnail generation for files that are missing them.
 * If folderPath is null, it targets the whole library.
 */
export function queueThumbnailGeneration(
  folderPath: string | null,
  getMainWindow: () => BrowserWindow | null,
) {
  const db = getDb();
  const query = folderPath
    ? "SELECT path, name, extension, directory, size_bytes, modified_at FROM files WHERE path LIKE ? AND thumbnail IS NULL AND thumbnail_failed = 0"
    : "SELECT path, name, extension, directory, size_bytes, modified_at FROM files WHERE thumbnail IS NULL AND thumbnail_failed = 0";
  const params = folderPath ? [`${folderPath}%`] : [];

  const missingRows = db.prepare(query).all(...params) as Array<{
    path: string;
    name: string;
    extension: string;
    directory: string;
    size_bytes: number;
    modified_at: number;
  }>;

  const filesToThumbnail: ScannedFile[] = missingRows.map((row) => ({
    path: row.path,
    name: row.name,
    ext: row.extension,
    dir: row.directory,
    size: row.size_bytes,
    mtime: row.modified_at,
  }));

  if (filesToThumbnail.length > 0) {
    // Small delay to let the DB settle and UI update
    setTimeout(() => {
      generateThumbnailsInBackground(filesToThumbnail, getMainWindow);
    }, 500);
  }
}
