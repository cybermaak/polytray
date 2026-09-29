import { utilityProcess, UtilityProcess } from 'electron';
import path from 'path';
import fs from 'fs';
import { BrowserWindow } from 'electron';
import { Database } from 'better-sqlite3';
import { extractMetadata, type MetadataSummary } from './metadata';
import { scheduleSingleThumbnailGeneration } from './thumbnails';
import { EXT_SET, IPC, RuntimeSettingsData } from '../shared/types';
import { createWatcherLifecycleManager } from './watcherLifecycle';
import { createFileIndexRepository } from './fileIndexing';
import { createUnavailableMeasurement } from '../shared/model/measurement';
import { isPathContained } from './pathContainment';
import { createThumbnailIdentity } from './thumbnailIdentity';
import {
  createMetadataRestoreWatcherResumePlan,
  createWatcherNotificationBatcher,
  createWatcherRootAvailabilityTracker,
  createSerializedTransitionQueue,
  createWatcherUpdateCoordinator,
  type WatcherFileEvent,
} from './watcherLifecycle';

type WatcherMutationRunner = <T>(operation: () => T | Promise<T>) => Promise<T>;
const immediateMutationRunner: WatcherMutationRunner = operation => Promise.resolve().then(operation);
let watcherMutationRunner: WatcherMutationRunner = immediateMutationRunner;

const watcherLifecycle = createWatcherLifecycleManager<UtilityProcess>({
  createProcess: () => {
    const workerPath = path.join(__dirname, 'worker.js');
    return utilityProcess.fork(workerPath);
  },
});

interface ActiveWatcherContext {
  mainWindow: BrowserWindow;
  db: Database;
  settings: RuntimeSettingsData;
  roots: string[];
}

interface WatchedStat { size: number; modifiedAt: number; }

let watcherContext: ActiveWatcherContext | null = null;
let watcherRun = 0;
const watcherThumbnailSettings = new WeakMap<object, RuntimeSettingsData>();
const runWatcherTransition = createSerializedTransitionQueue();
const rootAvailability = createWatcherRootAvailabilityTracker();
const watcherNotifications = createWatcherNotificationBatcher((events: Array<{ type: string; filePath: string }>) => {
  const window = watcherContext?.mainWindow;
  if (!window || window.isDestroyed() || events.length === 0) return;
  const last = events[events.length - 1];
  window.webContents.send(IPC.FILES_UPDATED, {
    type: events.length === 1 ? last.type : 'batch',
    filePath: last.filePath,
  });
});

const watcherUpdates = createWatcherUpdateCoordinator<WatchedStat, MetadataSummary>({
  runMutation: (operation) => watcherMutationRunner(operation),
  stat: async (filePath) => {
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return null;
      return { size: stat.size, modifiedAt: Math.floor(stat.mtimeMs) };
    } catch {
      return null;
    }
  },
  getIdentity: (filePath) => {
    const context = watcherContext;
    return context ? createFileIndexRepository(context.db).getFileIdentityByPath(filePath) : null;
  },
  commit: (event, stat, current) => {
    const context = watcherContext;
    if (!context || !context.roots.some((root) => isPathContained(root, event.filePath))) return null;
    const ext = path.extname(event.filePath).toLowerCase().slice(1);
    const result = createFileIndexRepository(context.db).applyWatchUpdate({
      kind: event.type as 'add' | 'change',
      path: event.filePath,
      name: path.basename(event.filePath, `.${ext}`),
      extension: ext,
      directory: path.dirname(event.filePath),
      sizeBytes: stat.size,
      modifiedAt: stat.modifiedAt,
      archivePath: null,
      expectedContentRevision: current?.contentRevision ?? 0,
    });
    if (result.affectedPaths.length === 0) return null;
    return createFileIndexRepository(context.db).getFileIdentityByPath(event.filePath);
  },
  remove: (identity) => {
    const context = watcherContext;
    if (!context) return;
    createFileIndexRepository(context.db).applyWatchUpdate({
      kind: 'remove', path: identity.path, expectedContentRevision: identity.contentRevision,
    });
  },
  isRemovalSafe: async (filePath) => {
    const context = watcherContext;
    const root = context?.roots
      .filter((candidate) => isPathContained(candidate, filePath))
      .sort((left, right) => right.length - left.length)[0];
    if (!root) return false;
    try { return (await fs.promises.stat(root)).isDirectory(); }
    catch { return false; }
  },
  extractMetadata: async (identity) => {
    const ext = path.extname(identity.path).toLowerCase().slice(1);
    try {
      return await extractMetadata(identity.path, ext);
    } catch (error) {
      console.warn(`Watcher: Failed to extract metadata for ${identity.path}:`, (error as Error).message);
      return {
        vertexCount: 0,
        faceCount: 0,
        dimensions: createUnavailableMeasurement(ext === '3mf' ? 'mm' : 'model-unit', 'Metadata extraction has not completed'),
      };
    }
  },
  applyMetadata: (identity, metadata) => {
    const context = watcherContext;
    if (!context) return false;
    return createFileIndexRepository(context.db).applyMetadataResult({
      fileId: identity.id,
      path: identity.path,
      expectedContentRevision: identity.contentRevision,
      vertexCount: metadata.vertexCount,
      faceCount: metadata.faceCount,
      dimensions: metadata.dimensions ? JSON.stringify(metadata.dimensions) : null,
    }).status === 'updated';
  },
  generateThumbnail: async (identity) => {
    const context = watcherContext;
    if (!context) return null;
    const ext = path.extname(identity.path).toLowerCase().slice(1);
    watcherThumbnailSettings.set(identity, context.settings);
    return scheduleSingleThumbnailGeneration(identity.path, ext, context.settings, 'watch');
  },
  applyThumbnail: (identity, thumbnailPath) => {
    const context = watcherContext;
    if (!context) return false;
    const settings = watcherThumbnailSettings.get(identity) ?? context.settings;
    watcherThumbnailSettings.delete(identity);
    const repository = createFileIndexRepository(context.db);
    const result = repository.updateThumbnailState({
      fileId: identity.id,
      expectedContentRevision: identity.contentRevision,
      thumbnailPath,
      thumbnailFailed: thumbnailPath ? 0 : 1,
    });
    if (result.status !== 'updated') return false;
    if (thumbnailPath && context.mainWindow && !context.mainWindow.isDestroyed()) {
      const size = Number(settings.thumbQuality ?? 256) as 128 | 256 | 512;
      const { identity: thumbnailIdentity } = createThumbnailIdentity(
        identity.path, identity.contentRevision, settings.thumbnailColor, size,
      );
      context.mainWindow.webContents.send(IPC.THUMBNAIL_READY, {
        fileId: identity.id, thumbnailPath, identity: thumbnailIdentity,
        contentRevision: identity.contentRevision,
      });
      watcherNotifications.enqueue(identity.path, { type: 'thumbnail', filePath: identity.path });
    }
    return true;
  },
  onCommitted: (event: WatcherFileEvent) => {
    watcherNotifications.enqueue(event.filePath, { type: event.type, filePath: event.filePath });
  },
});

async function startWatcherNow(
  folderPaths: string[],
  mainWindow: BrowserWindow,
  db: Database,
  settings: RuntimeSettingsData,
  runMutation: WatcherMutationRunner = immediateMutationRunner,
  preservePending = false,
) {
  if (folderPaths.length === 0) {
    rootAvailability.retainConfiguredRoots([]);
    await stopWatcherNow();
    return;
  }

  if (!preservePending) watcherUpdates.invalidatePending();
  watcherNotifications.flush();
  const run = ++watcherRun;
  watcherMutationRunner = runMutation;
  const roots = [...new Set(folderPaths.map((folderPath) => path.resolve(folderPath)))];
  watcherContext = { mainWindow, db, settings, roots };
  rootAvailability.retainConfiguredRoots(roots);

  await watcherLifecycle.restart(
    {
      folderPaths: roots,
      watcherStability: settings.watcher_stability,
    },
    {
      onMessage: (msg) => {
        if (run !== watcherRun) return;
        const data = msg as { type?: string; filePath?: string; folderPath?: string; available?: boolean };
        if (data.type === 'root-status' && typeof data.folderPath === 'string' && typeof data.available === 'boolean') {
          handleRootStatus(data.folderPath, data.available, mainWindow);
          return;
        }
        if (!data.type || !data.filePath) return;

        if (path.extname(data.filePath).toLowerCase() === '.zip' &&
            (data.type === 'add' || data.type === 'change' || data.type === 'unlink')) {
          void handleArchiveChange(data.filePath, data.type, mainWindow, roots);
          return;
        }

        if (data.type === 'add' || data.type === 'change') {
          void handleFileChange(data.filePath, data.type);
        } else if (data.type === 'unlink') {
          void handleFileRemove(data.filePath);
        }
      },
      onExit: (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`Watcher worker exited suspiciously with code ${code}`);
        }
      },
    },
  );
}

export function startWatcher(
  folderPaths: string[],
  mainWindow: BrowserWindow,
  db: Database,
  settings: RuntimeSettingsData,
  runMutation: WatcherMutationRunner = immediateMutationRunner,
  preservePending = false,
) {
  return runWatcherTransition(() => startWatcherNow(folderPaths, mainWindow, db, settings, runMutation, preservePending));
}

async function stopWatcherNow(): Promise<void> {
  watcherRun++;
  watcherUpdates.invalidatePending();
  await watcherLifecycle.stop();
  watcherNotifications.flush();
  watcherContext = null;
}

export function stopWatcher(): Promise<void> {
  return runWatcherTransition(stopWatcherNow);
}

/** Update future watch-triggered enrichment without restarting the utility watcher. */
export function updateWatcherSettings(settings: RuntimeSettingsData): Promise<boolean> {
  return runWatcherTransition(() => {
    const context = watcherContext;
    if (!context) return false;
    watcherContext = { ...context, settings };
    return true;
  });
}

/** Build the release callback that aligns the worker to restored roots/settings. */
export function createMetadataRestoreWatcherResumeHandler(mainWindow: BrowserWindow, db: Database, runMutation: WatcherMutationRunner): (
  restored: { folderPaths: string[]; settings: RuntimeSettingsData; watch: boolean; autoScan: boolean },
) => Promise<void> {
  let resumed = false;
  return async (restored) => {
    if (resumed) return;
    resumed = true;
    if (mainWindow.isDestroyed()) return;
    const plan = createMetadataRestoreWatcherResumePlan(restored.folderPaths, {
      watch: restored.watch,
      autoScan: restored.autoScan,
    });
    if (plan.watchRoots.length > 0) {
      const current = watcherContext;
      const sameRoots = current && current.roots.length === plan.watchRoots.length &&
        current.roots.every((root, index) => root === plan.watchRoots[index]);
      const sameStability = current?.settings.watcher_stability === restored.settings.watcher_stability;
      if (current && sameRoots && sameStability) {
        const updated = await runWatcherTransition(() => {
          const latest = watcherContext;
          const stillSameRoots = latest && latest.roots.length === plan.watchRoots.length &&
            latest.roots.every((root, index) => root === plan.watchRoots[index]);
          if (!latest || !stillSameRoots || latest.settings.watcher_stability !== restored.settings.watcher_stability) return false;
          watcherMutationRunner = runMutation;
          watcherContext = { ...latest, settings: restored.settings };
          return true;
        });
        if (!updated) await startWatcher(plan.watchRoots, mainWindow, db, restored.settings, runMutation, true);
      } else {
        await startWatcher(plan.watchRoots, mainWindow, db, restored.settings, runMutation, true);
      }
    } else {
      await stopWatcher();
    }
    for (const root of plan.scanRoots) {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('trigger-rescan-folder', root);
    }
  };
}

async function handleFileChange(
  filePath: string,
  eventType: string,
) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!EXT_SET.has(ext)) return;
  try {
    await watcherUpdates.handle({ type: eventType as 'add' | 'change', filePath: path.resolve(filePath) });
  } catch (error) {
    console.warn(`Watcher: Failed to commit file change for ${filePath}:`, (error as Error).message);
  }
}

async function handleFileRemove(filePath: string) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!EXT_SET.has(ext)) return;
  try {
    await watcherUpdates.handle({ type: 'unlink', filePath: path.resolve(filePath) });
  } catch (error) {
    console.warn(`Watcher: Failed to commit file removal for ${filePath}:`, (error as Error).message);
  }
}

function handleRootStatus(folderPath: string, available: boolean, mainWindow: BrowserWindow) {
  const root = path.resolve(folderPath);
  if (!watcherContext?.roots.includes(root)) return;
  const { recovered } = rootAvailability.observe(root, available);
  if (mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC.FILES_UPDATED, {
    type: available ? 'root-available' : 'root-unavailable',
    filePath: root,
  });
  if (recovered) {
    // Let the established scan service prove which rows disappeared while this root was offline.
    mainWindow.webContents.send('trigger-rescan-folder', root);
  }
}

async function handleArchiveChange(filePath: string, eventType: string, mainWindow: BrowserWindow, roots: string[]) {
  const archivePath = path.resolve(filePath);
  const root = roots.find((candidate) => isPathContained(candidate, archivePath));
  if (!root) return;
  try {
    if (!(await fs.promises.stat(root)).isDirectory()) return;
  } catch {
    return;
  }
  if (mainWindow.isDestroyed()) return;
  const containingFolder = path.dirname(archivePath);
  if (!roots.some((candidate) => isPathContained(candidate, containingFolder))) return;
  watcherNotifications.enqueue(archivePath, { type: eventType, filePath: archivePath });
  // A contained folder rescan uses the scanner's archive coverage rules, which retain members on ZIP read errors.
  mainWindow.webContents.send('trigger-rescan-folder', containingFolder);
}
