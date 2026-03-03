import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  nativeImage,
  Menu,
  shell,
  clipboard,
} from "electron";
import { join } from "path";
import { initDatabase, getDb, getSetting, setSetting } from "./database";
import { scanFolder } from "./scanner";
import { extractMetadata } from "./metadata";
import { generateThumbnail, getThumbnailDir } from "./thumbnails";
import { startWatcher, stopWatcher } from "./watcher";
import fs from "fs";

import {
  FileRecord,
  CountRow,
  TotalRow,
  ScannedFile,
  IPC,
} from "../shared/types";

// Set the application name for macOS menu bar
app.setName("PolyTray");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "polytray",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

// ── Portable Mode Initialization ─────────────────────────────────────
const exePath = app.getPath("exe");
let exeDir = join(exePath, "..");

// On macOS, the actual executable is inside MyApp.app/Contents/MacOS/
if (process.platform === "darwin" && exePath.includes(".app/Contents/MacOS")) {
  exeDir = join(exePath, "../../../.."); // Point to the directory containing MyApp.app
}

const portableDataDir = join(exeDir, "polytray-data");
const portableFlag = join(exeDir, ".portable");

// Use portable data directory if it exists, or if the .portable flag file exists
if (fs.existsSync(portableDataDir)) {
  app.setPath("userData", portableDataDir);
} else if (fs.existsSync(portableFlag)) {
  app.setPath("userData", portableDataDir);
}
// ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

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

  // Define Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline'; " +
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
              "font-src 'self' https://fonts.gstatic.com; " +
              "img-src 'self' data: blob:; " +
              "connect-src 'self' http://localhost:* ws://localhost:* polytray:;",
          ],
        },
      });
    },
  );

  // Force quit when the main window is closed, especially on macOS
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

// ── IPC Handlers ──────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Library Folder Management ─────────────────────────────────

  ipcMain.handle(IPC.SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "Select 3D Models Folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];
    const folders = getSetting<string[]>("library_folders", []);
    if (!folders.includes(folderPath)) {
      folders.push(folderPath);
    }
    setSetting("library_folders", folders);
    setSetting("last_folder", folderPath);

    return folderPath;
  });

  ipcMain.handle(IPC.GET_LIBRARY_FOLDERS, () => {
    return getSetting<string[]>("library_folders", []);
  });

  ipcMain.handle(IPC.REMOVE_LIBRARY_FOLDER, (event, folderPath) => {
    let folders = getSetting<string[]>("library_folders", []);
    folders = folders.filter((f: string) => f !== folderPath);
    setSetting("library_folders", folders);
    // Remove files from this folder
    const db = getDb();
    db.prepare("DELETE FROM files WHERE directory LIKE ?").run(
      folderPath + "%",
    );
    return folders;
  });

  ipcMain.handle(IPC.GET_LAST_FOLDER, () => {
    return getSetting<string | null>("last_folder", null);
  });

  // ── Scanning ──────────────────────────────────────────────────

  async function performScan(folderPath: string) {
    const db = getDb();
    const files = await scanFolder(folderPath);
    const total = files.length;

    const existingPaths = new Set(
      db
        .prepare("SELECT path FROM files WHERE directory LIKE ?")
        .all(folderPath + "%")
        .map((r) => (r as any).path),
    );

    // ── Pass 1: Index files quickly (metadata only, no thumbnails) ──
    const filesToThumbnail = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      existingPaths.delete(file.path);

      const existing = db
        .prepare(
          "SELECT modified_at, size_bytes, thumbnail, thumbnail_failed FROM files WHERE path = ?",
        )
        .get(file.path) as any;
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
      } catch (e: any) {
        console.warn(`Failed to extract metadata for ${file.path}:`, e.message);
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
    // Don't await — return immediately so the UI stays responsive
    generateThumbnailsInBackground(filesToThumbnail, db);

    return { totalFiles: total };
  }

  ipcMain.handle(IPC.SCAN_FOLDER, async (event, folderPath) => {
    return performScan(folderPath);
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
    if (fs.existsSync(thumbDir)) {
      const files = fs.readdirSync(thumbDir);
      for (const file of files) {
        if (file.endsWith(".png")) {
          fs.unlinkSync(join(thumbDir, file));
        }
      }
    }
    // Set modified_at to 0 so the scanner regenerates the thumbnails next scan
    db.prepare("UPDATE files SET modified_at = 0, thumbnail = null").run();
    return true;
  });

  // ── File Queries ──────────────────────────────────────────────

  ipcMain.handle(IPC.GET_FILES, (event, opts = {}) => {
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
    const sortCol = (validSorts as any)[sort] || "name";
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

    const countQuery = `SELECT COUNT(*) as total FROM files ${whereClause}`;
    const countRow = db.prepare(countQuery).get(...params) as TotalRow;

    const collation = sortCol === "name" ? "COLLATE NOCASE " : "";
    const query = `SELECT * FROM files ${whereClause} ORDER BY ${sortCol} ${collation}${sortOrder} LIMIT ? OFFSET ?`;
    const files = db
      .prepare(query)
      .all(...params, limit, offset) as FileRecord[];

    return { files, total: countRow.total };
  });

  ipcMain.handle(IPC.GET_FILE_BY_ID, (event, id) => {
    const db = getDb();
    return db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  });

  ipcMain.handle(IPC.READ_FILE_BUFFER, async (event, filePath) => {
    // Validate that the file is part of the indexed library
    const db = getDb();
    const record = db
      .prepare("SELECT id FROM files WHERE path = ?")
      .get(filePath);
    if (!record) {
      throw new Error("Access denied: File not in library");
    }

    const buffer = await fs.promises.readFile(filePath);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  });

  // ── Thumbnail Loading (serve as base64 data URL) ──────────────

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
    } catch (e) {
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
      if (!mainWindow) return null;
      const thumbnailPath = await generateThumbnail(filePath, ext, mainWindow);
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

  ipcMain.on(IPC.ON_DRAG_START, (event, filePath) => {
    // Ideally we would extract the thumbnail as the icon, but creating from built icon works as a general drag
    const icon = nativeImage.createFromPath(
      join(__dirname, "../../build/icon.png"),
    );
    event.sender.startDrag({
      file: filePath,
      icon: icon,
    });
  });

  ipcMain.on(IPC.SHOW_CONTEXT_MENU, (event, filePath) => {
    const template = [
      {
        label: "Reveal in Finder / Explorer",
        click: () => {
          shell.showItemInFolder(filePath);
        },
      },
      {
        label: "Copy Absolute Path",
        click: () => {
          clipboard.writeText(filePath);
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
  });

  // ── Other ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.RESCAN, async () => {
    return getSetting<string | null>("last_folder", null);
  });

  ipcMain.handle(IPC.GET_STATS, () => {
    const db = getDb();
    const total = (
      db.prepare("SELECT COUNT(*) as count FROM files").get() as any
    ).count;
    const stl = (
      db
        .prepare("SELECT COUNT(*) as count FROM files WHERE extension = 'stl'")
        .get() as any
    ).count;
    const obj = (
      db
        .prepare("SELECT COUNT(*) as count FROM files WHERE extension = 'obj'")
        .get() as any
    ).count;
    const threemf = (
      db
        .prepare("SELECT COUNT(*) as count FROM files WHERE extension = '3mf'")
        .get() as any
    ).count;
    const totalSize = (
      db
        .prepare("SELECT COALESCE(SUM(size_bytes), 0) as total FROM files")
        .get() as any
    ).total;
    return { total, stl, obj, threemf, totalSize };
  });

  ipcMain.handle(IPC.START_WATCHING, (event, folderPath) => {
    if (mainWindow) {
      startWatcher(folderPath, mainWindow, getDb());
    }
  });

  ipcMain.handle(IPC.STOP_WATCHING, () => {
    stopWatcher();
  });
}

// ── Background Thumbnail Generation (throttled) ──────────────

async function generateThumbnailsInBackground(
  filesToThumbnail: ScannedFile[],
  db: any,
) {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const total = filesToThumbnail.length;
  if (total === 0) return;

  // Notify renderer that thumbnail generation is starting
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.THUMBNAIL_PROGRESS, {
      current: 0,
      total,
      filename: "",
      phase: "start",
    });
  }

  for (let i = 0; i < total; i++) {
    // Bail out if window was closed
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const file = filesToThumbnail[i];

    // Yield to the event loop so IPC and the renderer don't starve/freeze
    await delay(50);

    try {
      const thumbnailPath = await generateThumbnail(
        file.path,
        file.ext,
        mainWindow,
      );
      if (thumbnailPath) {
        db.prepare("UPDATE files SET thumbnail = ? WHERE path = ?").run(
          thumbnailPath,
          file.path,
        );
        if (!mainWindow || mainWindow.isDestroyed()) return;

        const row = db
          .prepare("SELECT id FROM files WHERE path = ?")
          .get(file.path);
        if (row) {
          mainWindow.webContents.send(IPC.THUMBNAIL_READY, {
            fileId: row.id,
            thumbnailPath,
          });
        }
      } else {
        db.prepare("UPDATE files SET thumbnail_failed = 1 WHERE path = ?").run(
          file.path,
        );
      }
    } catch (e: any) {
      console.warn(`Failed to generate thumbnail for ${file.path}:`, e.message);
    }

    // Send progress update
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.THUMBNAIL_PROGRESS, {
        current: i + 1,
        total,
        filename: file.name,
        phase: "progress",
      });
    }

    // Throttle: give the renderer breathing room between renders
    await delay(150);
  }

  // Notify renderer that thumbnail generation is done
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.THUMBNAIL_PROGRESS, {
      current: total,
      total,
      filename: "",
      phase: "done",
    });
  }
}

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  protocol.handle("polytray", (request) => {
    const urlStr = request.url.slice("polytray://local/".length);
    const filePath = decodeURIComponent(urlStr.split("?")[0]);
    return net.fetch("file://" + filePath);
  });

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
  app.quit();
});
