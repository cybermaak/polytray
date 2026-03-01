import chokidar, { FSWatcher } from "chokidar";
import path from "path";
import { extractMetadata } from "./metadata";
import { generateThumbnail } from "./thumbnails";

const SUPPORTED_EXTENSIONS = new Set(["stl", "obj", "3mf"]);

let watcher: FSWatcher | null = null;

/**
 * Starts watching a folder for 3D file changes.
 * @param {string} folderPath - Directory to watch
 * @param {any} mainWindow - Main window for sending IPC updates
 * @param {any} db - SQLite database instance
 */
export function startWatcher(folderPath: string, mainWindow: any, db: any) {
  stopWatcher();

  watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\./, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    depth: 99,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  watcher.on("add", (filePath: string) =>
    handleFileChange(filePath, "add", mainWindow, db),
  );
  watcher.on("change", (filePath: string) =>
    handleFileChange(filePath, "change", mainWindow, db),
  );
  watcher.on("unlink", (filePath: string) =>
    handleFileRemove(filePath, mainWindow, db),
  );

  watcher.on("error", (error: any) => {
    console.error("Watcher error:", error);
  });
}

export function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

async function handleFileChange(
  filePath: string,
  eventType: string,
  mainWindow: any,
  db: any,
) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return;

  try {
    const stat = await import("fs").then((fs) => fs.promises.stat(filePath));
    const name = path.basename(filePath, "." + ext);
    const dir = path.dirname(filePath);

    let meta = { vertexCount: 0, faceCount: 0 };
    try {
      meta = await extractMetadata(filePath, ext);
    } catch (e: any) {
      console.warn(
        `Watcher: Failed to extract metadata for ${filePath}:`,
        e.message,
      );
    }

    let thumbnailPath = null;
    try {
      thumbnailPath = await generateThumbnail(filePath, ext, mainWindow);
    } catch (e: any) {
      console.warn(
        `Watcher: Failed to generate thumbnail for ${filePath}:`,
        e.message,
      );
    }

    db.prepare(
      `
      INSERT OR REPLACE INTO files (path, name, extension, directory, size_bytes, modified_at, vertex_count, face_count, thumbnail, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      Date.now(),
    );

    mainWindow.webContents.send("files-updated", { type: eventType, filePath });
  } catch (e: any) {
    console.warn(
      `Watcher: Error processing ${eventType} for ${filePath}:`,
      e.message,
    );
  }
}

function handleFileRemove(filePath: string, mainWindow: any, db: any) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return;

  db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
  mainWindow.webContents.send("files-updated", { type: "unlink", filePath });
}
