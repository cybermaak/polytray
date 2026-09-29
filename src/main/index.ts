import { app, BrowserWindow, ipcMain, protocol, net } from "electron";
import { join } from "path";
import { randomUUID } from "node:crypto";
import { getDb, initDatabase } from "./database";
import { stopWatcher } from "./watcher";
import {
  initThumbnailService,
  getThumbnailBackgroundJobs,
  pauseThumbnailJob,
  resumeThumbnailJob,
  cancelThumbnailJob,
  retryThumbnailJobFailures,
} from "./thumbnails";
import fs from "fs";
import { getThumbnailDir } from "./thumbnails";
import { toAllowedLocalFileUrl } from "./localFileProtocol";
import { IPC, METADATA_RESTORE_IPC, type IndexMutationResult, type MainWindowVisibilityData, type RuntimeSettingsData } from "../shared/types";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings, toRuntimeSettings } from "../shared/settings";
import type { MetadataBackupSnapshot, StagedMetadataRestore } from "../shared/backupContracts";
import { createFileIndexRuntime, type FileIndexRuntime } from "./fileIndexRuntime";
import { createLibraryMutationPublisher, type LibraryMutationPublisher } from "./libraryMutationPublisher";

// IPC handler modules
import { registerLibraryHandlers } from "./ipc/library";
import { registerScanningHandlers } from "./ipc/scanning";
import { registerBackgroundJobCommandHandlers } from "./backgroundJobCommands";
import { registerFileHandlers } from "./ipc/files";
import { registerThumbnailHandlers } from "./ipc/thumbnails";
import { registerSystemHandlers } from "./ipc/system";
import { registerSlicerHandlers, startSlicerStartupCleanup } from "./ipc/slicer";
import { createElectronPreviewWindowManager } from "./previewWindow";
import { registerPreviewParseHandler } from "./previewParseService";
import { createMetadataRestoreService } from "./metadataRestoreService";
import { createMetadataRestoreJournal } from "./metadataRestoreJournal";
import { createMetadataRestoreLeaseReservation, createMetadataRestoreMutationGate } from "./metadataRestoreMutationGate";
import { registerMetadataRestoreHandlers } from "./ipc/metadataBackup";
import { createMetadataRestoreWatcherResumeHandler } from "./watcher";

// Set the application name for macOS menu bar
app.setName("PolyTray");

// ── Structured Logging (TD2) ────────────────────────────────────────
import log from "electron-log/main";
import { homedir } from "os";

log.transports.file.resolvePathFn = () => join(homedir(), ".polytray", "logs", "app.log");
if (app.isPackaged && !process.env.POLYTRAY_LOGGING) {
  log.transports.file.level = false;
}
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
let slicerHandlers: ReturnType<typeof registerSlicerHandlers> | null = null;
let thumbnailWindow: BrowserWindow | null = null;
let mainWindowVisibilityRevision = 0;
function getWindowRendererPid(target: BrowserWindow | null): number {
  try {
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return 0;
    return target.webContents.getOSProcessId();
  } catch {
    return 0;
  }
}
const previewRuntime = createElectronPreviewWindowManager(() => [
  getWindowRendererPid(mainWindow),
  getWindowRendererPid(thumbnailWindow),
]);
let previewParseRegistration: ReturnType<typeof registerPreviewParseHandler> | null = null;
let fileIndexRuntime: FileIndexRuntime | null = null;
let scanningHandlers: ReturnType<typeof registerScanningHandlers> | null = null;
let libraryMutationPublisher: LibraryMutationPublisher | null = null;
let metadataRestoreService: ReturnType<typeof createMetadataRestoreService> | null = null;
const metadataRestoreMutationGate = createMetadataRestoreMutationGate();
const metadataRestoreLeaseReservation = createMetadataRestoreLeaseReservation();
let rendererRestoreSnapshot: MetadataBackupSnapshot & { preferences: Record<string, unknown> } = {
  rendererRevision: 0,
  libraryRoots: [],
  collections: [],
  preferences: { ...DEFAULT_APP_SETTINGS },
};
let startupReadyResolve!: () => void;
const startupReady = new Promise<void>(resolve => { startupReadyResolve = resolve; });
let startupComplete = false;
let blockedStartupMutationLeaseRelease: (() => Promise<void>) | null = null;
let blockedStartupLeaseReservationRelease: (() => void) | null = null;
let blockedStartupRendererLocked = false;
const rendererCommandAcks = new Map<string, { resolve: () => void; timer: NodeJS.Timeout }>();

function updateRendererRestoreSnapshot(snapshot: MetadataBackupSnapshot & { preferences: Record<string, unknown> }) {
  rendererRestoreSnapshot = {
    rendererRevision: snapshot.rendererRevision,
    libraryRoots: [...snapshot.libraryRoots],
    collections: snapshot.collections.map(collection => ({ ...collection, paths: [...collection.paths] })),
    preferences: { ...snapshot.preferences },
  };
}

async function runMainMutation<T>(operation: () => T | Promise<T>): Promise<T> {
  await startupReady;
  return metadataRestoreMutationGate.run(operation);
}

function requestRendererCommand(channel: string, payload: Record<string, unknown>): Promise<void> {
  const target = mainWindow;
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) {
    return Promise.reject(new Error("Metadata restore renderer is unavailable"));
  }
  const requestId = randomUUID();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      rendererCommandAcks.delete(requestId);
      reject(new Error("Timed out waiting for renderer metadata restore acknowledgment"));
    }, 30_000);
    rendererCommandAcks.set(requestId, { resolve: () => { clearTimeout(timer); resolve(); }, timer });
    target.webContents.send(channel, { ...payload, requestId });
  });
}

function applyRendererRestoreState(state: StagedMetadataRestore) {
  return requestRendererCommand(METADATA_RESTORE_IPC.applyEvent, { state });
}

function setRendererRestoreMutationLock(locked: boolean) {
  return requestRendererCommand(METADATA_RESTORE_IPC.mutationLockEvent, { locked });
}

function acknowledgeRendererCommand(event: Electron.IpcMainInvokeEvent, requestId: unknown) {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof requestId !== "string") {
    throw new Error("Invalid metadata restore renderer acknowledgment");
  }
  const pending = rendererCommandAcks.get(requestId);
  if (!pending) throw new Error("Metadata restore renderer acknowledgment is no longer pending");
  rendererCommandAcks.delete(requestId);
  pending.resolve();
}

function readMainWindowVisibility(target: BrowserWindow): MainWindowVisibilityData {
  return {
    visible: !target.isDestroyed() && target.isVisible() && !target.isMinimized(),
    revision: mainWindowVisibilityRevision,
  };
}

function publishMainWindowVisibility(target: BrowserWindow) {
  if (target.isDestroyed()) return;
  mainWindowVisibilityRevision++;
  target.webContents.send(IPC.MAIN_WINDOW_VISIBILITY, readMainWindowVisibility(target));
}

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
      backgroundThrottling: true, // Visible viewer pauses while hidden; background workers stay unthrottled.
    },
  });
  const visibleWindow = mainWindow;
  const publishVisibility = () => publishMainWindowVisibility(visibleWindow);
  visibleWindow.on("minimize", publishVisibility);
  visibleWindow.on("restore", publishVisibility);
  visibleWindow.on("show", publishVisibility);
  visibleWindow.on("hide", publishVisibility);
  visibleWindow.webContents.on("did-finish-load", publishVisibility);

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
    void previewParseRegistration?.dispose();
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
  ipcMain.handle(IPC.GET_MAIN_WINDOW_VISIBILITY, (event) => {
    const currentWindow = mainWindow;
    if (!currentWindow || currentWindow.isDestroyed() || event.sender !== currentWindow.webContents) {
      throw new Error("Main window visibility is unavailable to this renderer");
    }
    return readMainWindowVisibility(currentWindow);
  });
  registerLibraryHandlers(getMainWindow, { runMutation: runMainMutation });
  scanningHandlers = registerScanningHandlers(getMainWindow, undefined, { runMutation: runMainMutation });
  const scanJobs = scanningHandlers.scanJobs;
  registerBackgroundJobCommandHandlers(ipcMain, {
    getJobs: async () => [...await scanJobs.getBackgroundJobs(), ...await getThumbnailBackgroundJobs()],
    scanJobs,
    thumbnailJobs: {
      pauseThumbnailJob,
      resumeThumbnailJob,
      cancelThumbnailJob,
      retryThumbnailJobFailures,
    },
  });
  registerFileHandlers({
    isScopeIndexReady: () => fileIndexRuntime?.canUseScopeReader() === true,
    ensureScopeIndexReady: async () => {
      const runtime = fileIndexRuntime;
      if (!runtime) throw new Error("File index runtime is unavailable");
      await runMainMutation(() => runtime.startBackfill());
      if (!runtime.canUseScopeReader()) throw new Error("Library scope index is not ready");
    },
    runMutation: runMainMutation,
  });
  registerThumbnailHandlers(getMainWindow);
  registerSystemHandlers(getMainWindow, { runMutation: runMainMutation });
  slicerHandlers = registerSlicerHandlers(getMainWindow);
  previewParseRegistration = registerPreviewParseHandler(ipcMain, getMainWindow, previewRuntime);
  initThumbnailService();
}

function registerMetadataRestoreCommandAcks() {
  ipcMain.handle(METADATA_RESTORE_IPC.applyAck, (event, raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid metadata restore acknowledgment");
    const payload = raw as { requestId?: unknown; snapshot?: unknown };
    const snapshot = payload.snapshot as MetadataBackupSnapshot & { preferences: Record<string, unknown> };
    if (!snapshot || typeof snapshot !== "object" || !Number.isSafeInteger(snapshot.rendererRevision) ||
        !Array.isArray(snapshot.libraryRoots) || !Array.isArray(snapshot.collections) ||
        !snapshot.preferences || typeof snapshot.preferences !== "object" || Array.isArray(snapshot.preferences)) {
      throw new Error("Invalid metadata restore renderer snapshot");
    }
    updateRendererRestoreSnapshot(snapshot);
    acknowledgeRendererCommand(event, payload.requestId);
    return { status: "applied" };
  });
  ipcMain.handle(METADATA_RESTORE_IPC.mutationLockAck, (event, raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid metadata restore lock acknowledgment");
    acknowledgeRendererCommand(event, (raw as { requestId?: unknown }).requestId);
    return { status: "acknowledged" };
  });
}

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  protocol.handle("polytray", (request) => {
    const fileUrl = toAllowedLocalFileUrl(request.url, {
      thumbnailDir: getThumbnailDir(),
      isIndexedFilePath: (filePath) => {
        const row = getDb()
          .prepare("SELECT 1 FROM files WHERE path = ? LIMIT 1")
          .get(filePath) as { 1: number } | undefined;
        return Boolean(row);
      },
    });

    if (!fileUrl) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(fileUrl);
  });

  initDatabase();
  libraryMutationPublisher = createLibraryMutationPublisher({
    send: (mutation: IndexMutationResult) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.send(IPC.LIBRARY_CHANGED, mutation);
    },
  });
  fileIndexRuntime = createFileIndexRuntime(getDb(), {
    onMutation: (mutation) => libraryMutationPublisher?.publish(mutation),
    onProgress: (progress) => {
      log.info("[FileIndex] scope backfill", progress);
      if (progress.status === "failed") log.error("[FileIndex] scope backfill failed", progress.error);
    },
  });
  const userData = app.getPath("userData");
  metadataRestoreService = createMetadataRestoreService({
    db: getDb(),
    journal: createMetadataRestoreJournal(join(userData, "metadata-restore", "journal")),
    recoveryDirectory: join(userData, "metadata-restore", "backups"),
    getRendererRevision: () => rendererRestoreSnapshot.rendererRevision,
    getRendererState: () => ({
      libraryRoots: [...rendererRestoreSnapshot.libraryRoots],
      collections: rendererRestoreSnapshot.collections.map(collection => ({ ...collection, paths: [...collection.paths] })),
      preferences: { ...rendererRestoreSnapshot.preferences },
    }),
    applyRendererState: applyRendererRestoreState,
    acquireMutationLease: async () => {
      const releaseReservation = await metadataRestoreLeaseReservation.acquire();
      let releaseGate: (() => Promise<void>) | null = null;
      let rendererLocked = false;
      let resumeWatcher: ((restored: { folderPaths: string[]; settings: RuntimeSettingsData; watch: boolean; autoScan: boolean }) => Promise<void>) | null = null;
      try {
        await setRendererRestoreMutationLock(true);
        rendererLocked = true;
        releaseGate = await metadataRestoreMutationGate.acquire();
        const activeWindow = mainWindow;
        if (!activeWindow) throw new Error("Metadata restore renderer is unavailable");
        resumeWatcher = createMetadataRestoreWatcherResumeHandler(activeWindow, getDb(), runMainMutation);
        return async () => {
          try {
            if (rendererLocked) await setRendererRestoreMutationLock(false);
          } finally {
            try {
              const restoredSettings = normalizeAppSettings(rendererRestoreSnapshot.preferences);
              await resumeWatcher?.({
                folderPaths: [...rendererRestoreSnapshot.libraryRoots],
                settings: toRuntimeSettings(restoredSettings),
                watch: restoredSettings.watch,
                autoScan: restoredSettings.autoScan,
              });
            }
            finally {
              try { await releaseGate?.(); }
              finally { releaseReservation(); }
            }
          }
        };
      } catch (error) {
        if (releaseGate) await releaseGate().catch(() => undefined);
        if (rendererLocked) await setRendererRestoreMutationLock(false).catch(() => undefined);
        releaseReservation();
        throw error;
      }
    },
    withCommitBoundary: commit => commit(),
  });

  registerMetadataRestoreCommandAcks();
  registerIpcHandlers();
  registerMetadataRestoreHandlers({
    ipcMain,
    service: metadataRestoreService,
    updateRendererSnapshot: updateRendererRestoreSnapshot,
    applyRendererState: applyRendererRestoreState,
    runMutation: runMainMutation,
    authorizeRenderer: event => {
      if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Metadata restore is available only to the main window");
    },
    holdRendererStateOnBlocked: async () => {
      if (metadataRestoreMutationGate.isLocked()) {
        await setRendererRestoreMutationLock(true);
        blockedStartupRendererLocked = true;
        return;
      }
      const releaseReservation = await metadataRestoreLeaseReservation.acquire();
      let rendererLocked = false;
      try {
        await setRendererRestoreMutationLock(true);
        rendererLocked = true;
        blockedStartupMutationLeaseRelease = await metadataRestoreMutationGate.acquire();
        blockedStartupLeaseReservationRelease = releaseReservation;
      } catch (error) {
        if (rendererLocked) await setRendererRestoreMutationLock(false).catch(() => undefined);
        releaseReservation();
        throw error;
      }
      blockedStartupRendererLocked = true;
    },
    prepareRecoveryRetry: async () => {
      const release = blockedStartupMutationLeaseRelease;
      blockedStartupMutationLeaseRelease = null;
      if (release) await release();
      const releaseReservation = blockedStartupLeaseReservationRelease;
      blockedStartupLeaseReservationRelease = null;
      releaseReservation?.();
    },
    startAfterRecovery: async () => {
      if (startupComplete) return;
      const runtime = fileIndexRuntime;
      if (!runtime) throw new Error("File index runtime is unavailable");
      await metadataRestoreMutationGate.run(() => runtime.startBackfill());
      startupComplete = true;
      startupReadyResolve();
      if (blockedStartupRendererLocked) {
        blockedStartupRendererLocked = false;
        await setRendererRestoreMutationLock(false);
      }
    },
  });
  createWindow();
  createThumbnailWindow();
  startSlicerStartupCleanup(
    () => {
      app.once("will-quit", () => {
        slicerHandlers?.dispose();
        void scanningHandlers?.dispose();
        void fileIndexRuntime?.dispose();
        metadataRestoreService?.dispose();
        libraryMutationPublisher?.flush();
        libraryMutationPublisher?.dispose();
        void previewParseRegistration?.dispose();
      });
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    },
    () => slicerHandlers?.cleanup() ?? Promise.resolve(),
    (report) => log.warn("[SlicerHandoff] startup cleanup was incomplete", report),
  );
});

app.on("window-all-closed", () => {
  stopWatcher();
  app.quit();
});
