import chokidar from "chokidar";
import path from "path";
import { extractMetadata } from "./metadata.js";
import { generateThumbnail } from "./thumbnails.js";

const SUPPORTED_EXTENSIONS = new Set(["stl", "obj", "3mf"]);

let watcher = null;

/**
 * Starts watching a folder for 3D file changes.
 * @param {string} folderPath - Directory to watch
 * @param {BrowserWindow} mainWindow - Main window for sending IPC updates
 * @param {Database} db - SQLite database instance
 */
export function startWatcher(folderPath, mainWindow, db) {
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

  watcher.on("add", (filePath) =>
    handleFileChange(filePath, "add", mainWindow, db),
  );
  watcher.on("change", (filePath) =>
    handleFileChange(filePath, "change", mainWindow, db),
  );
  watcher.on("unlink", (filePath) =>
    handleFileRemove(filePath, mainWindow, db),
  );

  watcher.on("error", (error) => {
    console.error("Watcher error:", error);
  });
}

export function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

async function handleFileChange(filePath, eventType, mainWindow, db) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return;

  try {
    const stat = await import("fs").then((fs) => fs.promises.stat(filePath));
    const name = path.basename(filePath, "." + ext);
    const dir = path.dirname(filePath);

    let meta = { vertexCount: 0, faceCount: 0 };
    try {
      meta = await extractMetadata(filePath, ext);
    } catch (e) {
      console.warn(
        `Watcher: Failed to extract metadata for ${filePath}:`,
        e.message,
      );
    }

    let thumbnailPath = null;
    try {
      thumbnailPath = await generateThumbnail(filePath, ext, mainWindow);
    } catch (e) {
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
  } catch (e) {
    console.warn(
      `Watcher: Error processing ${eventType} for ${filePath}:`,
      e.message,
    );
  }
}

function handleFileRemove(filePath, mainWindow, db) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return;

  db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
  mainWindow.webContents.send("files-updated", { type: "unlink", filePath });
}
