import { app, BrowserWindow, ipcMain, dialog, protocol } from "electron";
import { join } from "path";
import { initDatabase, getDb } from "./database.js";
import { scanFolder } from "./scanner.js";
import { extractMetadata } from "./metadata.js";
import { generateThumbnail, getThumbnailDir } from "./thumbnails.js";
import { startWatcher, stopWatcher } from "./watcher.js";
import fs from "fs";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0f",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ── IPC Handlers ──────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Library Folder Management ─────────────────────────────────

  ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select 3D Models Folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];
    const db = getDb();

    // Add to library folders (persist multiple folders)
    const existing = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("library_folders");
    let folders = existing ? JSON.parse(existing.value) : [];
    if (!folders.includes(folderPath)) {
      folders.push(folderPath);
    }
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run("library_folders", JSON.stringify(folders));
    // Also update last_folder for quick access
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run("last_folder", folderPath);

    return folderPath;
  });

  ipcMain.handle("get-library-folders", () => {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("library_folders");
    return row ? JSON.parse(row.value) : [];
  });

  ipcMain.handle("remove-library-folder", (event, folderPath) => {
    const db = getDb();
    const existing = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("library_folders");
    let folders = existing ? JSON.parse(existing.value) : [];
    folders = folders.filter((f) => f !== folderPath);
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run("library_folders", JSON.stringify(folders));
    // Remove files from this folder
    db.prepare("DELETE FROM files WHERE directory LIKE ?").run(
      folderPath + "%",
    );
    return folders;
  });

  ipcMain.handle("get-last-folder", () => {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("last_folder");
    return row ? row.value : null;
  });

  // ── Scanning ──────────────────────────────────────────────────

  ipcMain.handle("scan-folder", async (event, folderPath) => {
    const db = getDb();
    const files = await scanFolder(folderPath);
    const total = files.length;

    const existingPaths = new Set(
      db
        .prepare("SELECT path FROM files WHERE directory LIKE ?")
        .all(folderPath + "%")
        .map((r) => r.path),
    );

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      existingPaths.delete(file.path);

      const existing = db
        .prepare("SELECT modified_at, size_bytes FROM files WHERE path = ?")
        .get(file.path);
      if (
        existing &&
        existing.modified_at === file.mtime &&
        existing.size_bytes === file.size
      ) {
        mainWindow.webContents.send("scan-progress", {
          current: i + 1,
          total,
          filename: file.name,
          skipped: true,
        });
        continue;
      }

      let meta = { vertexCount: 0, faceCount: 0 };
      try {
        meta = await extractMetadata(file.path, file.ext);
      } catch (e) {
        console.warn(`Failed to extract metadata for ${file.path}:`, e.message);
      }

      let thumbnailPath = null;
      try {
        thumbnailPath = await generateThumbnail(
          file.path,
          file.ext,
          mainWindow,
        );
      } catch (e) {
        console.warn(
          `Failed to generate thumbnail for ${file.path}:`,
          e.message,
        );
      }

      db.prepare(
        `
        INSERT OR REPLACE INTO files (path, name, extension, directory, size_bytes, modified_at, vertex_count, face_count, thumbnail, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        file.path,
        file.name,
        file.ext,
        file.dir,
        file.size,
        file.mtime,
        meta.vertexCount,
        meta.faceCount,
        thumbnailPath,
        Date.now(),
      );

      mainWindow.webContents.send("scan-progress", {
        current: i + 1,
        total,
        filename: file.name,
        skipped: false,
      });
    }

    for (const stalePath of existingPaths) {
      db.prepare("DELETE FROM files WHERE path = ?").run(stalePath);
    }

    mainWindow.webContents.send("scan-complete", { totalFiles: total });
    return { totalFiles: total };
  });

  ipcMain.handle("scan-all-library", async () => {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("library_folders");
    const folders = row ? JSON.parse(row.value) : [];
    for (const folder of folders) {
      await ipcMain.emit("scan-folder-internal", folder);
    }
    return folders;
  });

  // ── File Queries ──────────────────────────────────────────────

  ipcMain.handle("get-files", (event, opts = {}) => {
    const db = getDb();
    const {
      sort = "name",
      order = "ASC",
      extension = null,
      search = "",
      limit = 200,
      offset = 0,
    } = opts;

    const validSorts = {
      name: "name",
      size: "size_bytes",
      date: "modified_at",
      vertices: "vertex_count",
      faces: "face_count",
    };
    const sortCol = validSorts[sort] || "name";
    const sortOrder = order === "DESC" ? "DESC" : "ASC";

    let where = [];
    let params = [];

    if (extension) {
      where.push("extension = ?");
      params.push(extension.toLowerCase());
    }
    if (search) {
      where.push("name LIKE ?");
      params.push(`%${search}%`);
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM files ${whereClause}`)
      .get(...params);
    const files = db
      .prepare(
        `SELECT * FROM files ${whereClause} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return { files, total: countRow.total };
  });

  ipcMain.handle("get-file-by-id", (event, id) => {
    const db = getDb();
    return db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  });

  ipcMain.handle("read-file-buffer", async (event, filePath) => {
    const buffer = await fs.promises.readFile(filePath);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  });

  // ── Thumbnail Loading (serve as base64 data URL) ──────────────

  ipcMain.handle("read-thumbnail", async (event, thumbnailPath) => {
    if (!thumbnailPath) return null;
    try {
      const data = await fs.promises.readFile(thumbnailPath);
      return `data:image/png;base64,${data.toString("base64")}`;
    } catch (e) {
      return null;
    }
  });

  ipcMain.handle("get-thumbnail-path", (event, fileId) => {
    const db = getDb();
    const row = db
      .prepare("SELECT thumbnail FROM files WHERE id = ?")
      .get(fileId);
    return row ? row.thumbnail : null;
  });

  // ── Other ─────────────────────────────────────────────────────

  ipcMain.handle("rescan", async () => {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("last_folder");
    if (!row) return null;
    return row.value;
  });

  ipcMain.handle("get-stats", () => {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) as count FROM files").get().count;
    const stl = db
      .prepare("SELECT COUNT(*) as count FROM files WHERE extension = 'stl'")
      .get().count;
    const obj = db
      .prepare("SELECT COUNT(*) as count FROM files WHERE extension = 'obj'")
      .get().count;
    const threemf = db
      .prepare("SELECT COUNT(*) as count FROM files WHERE extension = '3mf'")
      .get().count;
    const totalSize = db
      .prepare("SELECT COALESCE(SUM(size_bytes), 0) as total FROM files")
      .get().total;
    return { total, stl, obj, threemf, totalSize };
  });

  ipcMain.handle("start-watching", (event, folderPath) => {
    startWatcher(folderPath, mainWindow, getDb());
  });

  ipcMain.handle("stop-watching", () => {
    stopWatcher();
  });
}

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  initDatabase();
  createWindow();
  registerIpcHandlers();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopWatcher();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
