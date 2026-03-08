import { app, BrowserWindow, protocol, net } from "electron";
import { join } from "path";
import { initDatabase } from "./database";
import { stopWatcher } from "./watcher";
import fs from "fs";

// IPC handler modules
import { registerLibraryHandlers } from "./ipc/library";
import { registerScanningHandlers } from "./ipc/scanning";
import { registerFileHandlers } from "./ipc/files";
import { registerThumbnailHandlers } from "./ipc/thumbnails";
import { registerSystemHandlers } from "./ipc/system";

// Set the application name for macOS menu bar
app.setName("PolyTray");

// ── Structured Logging (TD2) ────────────────────────────────────────
import log from "electron-log/main";
import { homedir } from "os";

log.transports.file.resolvePathFn = () => join(homedir(), ".polytray", "logs", "app.log");
log.initialize();
Object.assign(console, log.functions);
log.info("🚀 PolyTray Main Process Starting...");
// ────────────────────────────────────────────────────────────────────

import inspector from "inspector";

// ── Profiling Hook ──────────────────────────────────────────────────
if (process.env.POLYTRAY_PROFILE) {
  const durationSeconds = parseInt(process.env.POLYTRAY_PROFILE, 10) || 15;
  const session = new inspector.Session();
  session.connect();
  session.post("Profiler.enable", () => {
    session.post("Profiler.start", () => {
      console.log(`🔴 [PROFILER] Started CPU Profiling for ${durationSeconds} seconds...`);
      setTimeout(() => {
        session.post("Profiler.stop", (err, { profile }) => {
          if (!err) {
            const profileDir = join(process.cwd(), "profiles");
            if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir);
            const profilePath = join(profileDir, `PolyTray_${Date.now()}.cpuprofile`);
            fs.writeFileSync(profilePath, JSON.stringify(profile));
            console.log(`🟢 [PROFILER] CPU profile written to ${profilePath}`);
          }
          session.disconnect();
        });
      }, durationSeconds * 1000);
    });
  });
}
// ───────────────────────────────────────────────────────────────────

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
let thumbnailWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getThumbnailWindow(): BrowserWindow | null {
  return thumbnailWindow;
}

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
      backgroundThrottling: false, // Critical: prevents macOS from completely freezing this hidden window
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
    if (thumbnailWindow) {
      thumbnailWindow.close();
    }
    app.quit();
  });
}

// ── Background Thumbnail Window ──────────────────────────────

function createThumbnailWindow() {
  thumbnailWindow = new BrowserWindow({
    show: false, // Keep it completely hidden!
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"), // Share preload so IPC works
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // Critical: prevents macOS from completely freezing this hidden window
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    thumbnailWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/src/renderer/thumbnail.html`);
  } else {
    thumbnailWindow.loadFile(join(__dirname, "../renderer/thumbnail.html"));
  }

  // Define Content Security Policy for thumbnail window as well
  thumbnailWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob:; " +
              "connect-src 'self' polytray:;",
          ],
        },
      });
    },
  );

  thumbnailWindow.on("closed", () => {
    thumbnailWindow = null;
  });
}

// ── IPC Registration ──────────────────────────────────────────

function registerIpcHandlers() {
  registerLibraryHandlers(getMainWindow);
  registerScanningHandlers(getMainWindow);
  registerFileHandlers();
  registerThumbnailHandlers(getMainWindow);
  registerSystemHandlers(getMainWindow);
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
  createThumbnailWindow();
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
