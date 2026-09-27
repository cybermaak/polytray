import { app, ipcMain, BrowserWindow, nativeImage } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import crypto from "crypto";
import {
  IPC,
  RuntimeSettingsData,
  ScannedFile,
} from "../shared/types";
import { getThumbnailWindow } from "./index";
import { getDb } from "./database";
import { createFileIndexRepository } from "./fileIndexing";
import { filterContainedPaths } from "./pathContainment";
import { createThumbnailJobScheduler } from "./thumbnailJobScheduler";
import { reconcileThumbnailCache } from "./thumbnailCacheLifecycle";
import { parseRuntimeSettings } from "./ipc/runtimeValidation";
import { canonicalizeThumbnailPath, createThumbnailAttemptRegistry, createThumbnailIdentity, createThumbnailRequestRegistry, readValidatedThumbnailCache, thumbnailCacheFilename, thumbnailRequestKey } from "./thumbnailIdentity";
import type { ThumbnailAttempt } from "../shared/thumbnailContracts";

let thumbnailDir: string | null = null;
const pendingRequests = createThumbnailAttemptRegistry<string | null>();
const inflightPromises = createThumbnailRequestRegistry<string | null>();
const cacheEpochs = new Map<string, number>();

function decodeThumbnailPng(data: Buffer) {
  try {
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    return { width, height };
  } catch {
    return null;
  }
}
const thumbnailScheduler = createThumbnailJobScheduler({
  execute: async (job) => {
    const startedAt = Date.now();
    try {
      return await generateThumbnail(job.filePath, job.ext, job.settings);
    } finally {
      console.info("[ThumbnailQueue]", {
        filePath: job.filePath,
        source: job.source,
        elapsedMs: Date.now() - startedAt,
      });
    }
  },
  onStats: (stats) => {
    console.info("[ThumbnailQueueStats]", stats);
  },
});

export function getThumbnailDir(): string {
  if (!thumbnailDir) {
    thumbnailDir = path.join(app.getPath("userData"), "thumbnails");
    if (!fsSync.existsSync(thumbnailDir)) {
      fsSync.mkdirSync(thumbnailDir, { recursive: true });
    }
  }
  return thumbnailDir;
}

export function advanceThumbnailCacheEpoch(filePath: string): number {
  const canonicalPath = canonicalizeThumbnailPath(filePath);
  const next = (cacheEpochs.get(canonicalPath) ?? 0) + 1;
  cacheEpochs.set(canonicalPath, next);
  pendingRequests.settleWhere((attempt) => attempt.key.canonicalPath === canonicalPath, null);
  return next;
}

function getThumbnailCacheEpoch(filePath: string): number {
  return cacheEpochs.get(canonicalizeThumbnailPath(filePath)) ?? 0;
}

/**
 * Initializes the thumbnail service by setting up a global IPC listener.
 */
export function initThumbnailService() {
  void reconcileThumbnailCache({
    thumbnailDir: getThumbnailDir(),
    referencedThumbnailPaths: (
      getDb().prepare("SELECT thumbnail FROM files WHERE thumbnail IS NOT NULL").all() as Array<{ thumbnail: string }>
    ).map((row) => row.thumbnail),
  }).catch((error) => {
    console.warn("[Thumbnails] Cache reconciliation failed:", error);
  });

  ipcMain.on(IPC.THUMBNAIL_GENERATED, async (event, result) => {
    const attempt = pendingRequests.get(result?.requestId);
    if (!attempt) return;
    if (event.sender !== getThumbnailWindow()?.webContents ||
        result.filePath !== attempt.key.canonicalPath || result.cacheEpoch !== attempt.cacheEpoch ||
        result.thumbPath !== path.join(getThumbnailDir(), thumbnailCacheFilename(JSON.stringify(attempt.key))) ||
        JSON.stringify(result.cacheKey) !== JSON.stringify(attempt.key)) return;
    if (!result.success || typeof result.dataUrl !== "string") {
      pendingRequests.settle(result.requestId, null);
      return;
    }

    const row = getDb().prepare("SELECT id, path, content_revision FROM files WHERE path = ? AND content_revision = ?").get(attempt.key.canonicalPath, attempt.key.contentRevision) as { id: number; path: string; content_revision: number } | undefined;
    if (!row || row.path !== attempt.key.canonicalPath ||
        (cacheEpochs.get(attempt.key.canonicalPath) ?? 0) !== attempt.cacheEpoch) {
      pendingRequests.settle(result.requestId, null);
      return;
    }

    let savedPath: string | null = null;
    const thumbPath = path.join(getThumbnailDir(), thumbnailCacheFilename(JSON.stringify(attempt.key)));
    const temporaryPath = `${thumbPath}.${result.requestId}.tmp`;
    try {
      const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, "");
      const image = Buffer.from(base64Data, "base64");
      const dimensions = decodeThumbnailPng(image);
      if (!dimensions || dimensions.width !== attempt.key.size || dimensions.height !== attempt.key.size) throw new Error("Renderer result is not a valid PNG of the requested size");
      await fs.writeFile(temporaryPath, image, { flag: "wx" });
      const current = getDb().prepare("SELECT path, content_revision FROM files WHERE id = ?").get(row.id) as { path: string; content_revision: number } | undefined;
      if (!current || current.path !== attempt.key.canonicalPath || current.content_revision !== attempt.key.contentRevision ||
          (cacheEpochs.get(attempt.key.canonicalPath) ?? 0) !== attempt.cacheEpoch) {
        await fs.rm(temporaryPath, { force: true });
      } else {
        await fs.rename(temporaryPath, thumbPath);
        const afterRename = getDb().prepare("SELECT path, content_revision FROM files WHERE id = ?").get(row.id) as { path: string; content_revision: number } | undefined;
        if (!afterRename || afterRename.path !== attempt.key.canonicalPath || afterRename.content_revision !== attempt.key.contentRevision ||
            (cacheEpochs.get(attempt.key.canonicalPath) ?? 0) !== attempt.cacheEpoch) {
          await fs.rm(thumbPath, { force: true });
        } else {
          savedPath = thumbPath;
        }
      }
    } catch (e: unknown) {
      console.warn(`[Thumbnails] Failed to save ${attempt.key.canonicalPath}:`, (e as Error).message);
    } finally {
      if (!savedPath) await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    pendingRequests.settle(result.requestId, savedPath);
  });

}

/**
 * Generates a thumbnail for a 3D model file.
 */
export async function generateThumbnail(
  filePath: string,
  ext: string,
  settings: RuntimeSettingsData,
): Promise<string | null> {
  const db = getDb();
  const identityRow = db.prepare("SELECT id, path, content_revision, thumbnail FROM files WHERE path = ?").get(filePath) as { id: number; path: string; content_revision: number; thumbnail: string | null } | undefined;
  if (!identityRow) return null;
  const size = Number(settings.thumbQuality ?? 256) as 128 | 256 | 512;
  const { cacheKey, key } = createThumbnailIdentity(identityRow.path, identityRow.content_revision, settings.thumbnailColor, size);
  const cacheEpoch = getThumbnailCacheEpoch(identityRow.path);
  const requestKey = thumbnailRequestKey(key, cacheEpoch);
  return inflightPromises.run(requestKey, async () => {
    // 2. Check cache first
    const thumbPath = path.join(getThumbnailDir(), thumbnailCacheFilename(key));
    const isCurrentIdentity = () => {
      const current = db.prepare("SELECT path, content_revision FROM files WHERE id = ?").get(identityRow.id) as { path: string; content_revision: number } | undefined;
      return !!current && current.path === identityRow.path && current.content_revision === identityRow.content_revision &&
        identityRow.path === canonicalizeThumbnailPath(filePath) && getThumbnailCacheEpoch(identityRow.path) === cacheEpoch;
    };
    const cached = await readValidatedThumbnailCache(
      () => fs.readFile(thumbPath),
      size,
      decodeThumbnailPng,
      isCurrentIdentity,
    );
    if (cached) return thumbPath;
    if (!isCurrentIdentity()) return null;
    const requestId = crypto.randomUUID();
    const attempt: ThumbnailAttempt = { requestId, cacheEpoch, key: cacheKey };
    const thumbWindow = getThumbnailWindow();
    if (!thumbWindow || thumbWindow.isDestroyed()) return null;

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const settle = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        thumbWindow.removeListener("closed", onClosed);
        resolve(value);
      };
      const timeout = setTimeout(() => pendingRequests.settle(requestId, null), settings.thumbnail_timeout);
      const onClosed = () => pendingRequests.settle(requestId, null);
      pendingRequests.register(attempt, settle);
      thumbWindow.once("closed", onClosed);
      try {
        thumbWindow.webContents.send(IPC.GENERATE_THUMBNAIL_REQUEST, {
          filePath: identityRow.path, ext, thumbPath, color: cacheKey.color,
          requestId, cacheKey, cacheEpoch, size, contentRevision: identityRow.content_revision,
        });
      } catch {
        pendingRequests.settle(requestId, null);
      }
    });
  });
}

/**
 * Orchestrates background thumbnail generation for a list of files.
 */
export async function generateThumbnailsInBackground(
  filesToThumbnail: ScannedFile[],
  getMainWindow: () => BrowserWindow | null,
  settings: RuntimeSettingsData,
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
    const repository = createFileIndexRepository(db);
    const currentIdentity = repository.getFileIdentityByPath(file.path);
    if (!currentIdentity) continue;
    await yieldToEventLoop();

    const startTime = Date.now();

    try {
      const thumbnailPath = await thumbnailScheduler.enqueue({
        filePath: file.path,
        ext: file.ext,
        settings,
        source: "scan",
        priority: 1,
        retries: 1,
        dedupeKey: thumbnailRequestKey(createThumbnailIdentity(currentIdentity.path, currentIdentity.contentRevision, settings.thumbnailColor, Number(settings.thumbQuality ?? 256) as 128 | 256 | 512).key, getThumbnailCacheEpoch(currentIdentity.path)),
      });
      if (thumbnailPath) {
        const update = repository.updateThumbnailState({ fileId: currentIdentity.id, expectedContentRevision: currentIdentity.contentRevision, thumbnailPath, thumbnailFailed: 0 });
        const currentWin = getMainWindow();
        if (update.status === "updated" && currentWin && !currentWin.isDestroyed()) {
          const { identity } = createThumbnailIdentity(currentIdentity.path, currentIdentity.contentRevision, settings.thumbnailColor, Number(settings.thumbQuality ?? 256) as 128 | 256 | 512);
          currentWin.webContents.send(IPC.THUMBNAIL_READY, { fileId: currentIdentity.id, thumbnailPath, identity, contentRevision: currentIdentity.contentRevision });
        }
      } else {
        repository.updateThumbnailState({ fileId: currentIdentity.id, expectedContentRevision: currentIdentity.contentRevision, thumbnailPath: null, thumbnailFailed: 1 });
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
  settings: RuntimeSettingsData,
) {
  const normalizedSettings = parseRuntimeSettings(settings);
  const db = getDb();
  const query =
    "SELECT path, name, extension, directory, size_bytes, modified_at FROM files WHERE thumbnail IS NULL AND thumbnail_failed = 0";

  const missingRows = db.prepare(query).all() as Array<{
    path: string;
    name: string;
    extension: string;
    directory: string;
    size_bytes: number;
    modified_at: number;
  }>;

  const allowedPaths =
    folderPath === null
      ? null
      : new Set(filterContainedPaths(folderPath, missingRows.map((row) => row.path)));

  const filesToThumbnail: ScannedFile[] = missingRows
    .filter((row) => allowedPaths === null || allowedPaths.has(row.path))
    .map((row) => ({
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
      generateThumbnailsInBackground(filesToThumbnail, getMainWindow, normalizedSettings).catch((error) => {
        console.warn("[Thumbnails] Background generation failed:", error);
      });
    }, 500);
  }
}

export function scheduleSingleThumbnailGeneration(
  filePath: string,
  ext: string,
  settings: RuntimeSettingsData,
  source: "watch" | "manual",
) {
  const normalizedSettings = parseRuntimeSettings(settings);
  const identity = createFileIndexRepository(getDb()).getFileIdentityByPath(filePath);
  if (!identity) return Promise.resolve(null);
  const { key } = createThumbnailIdentity(identity.path, identity.contentRevision, normalizedSettings.thumbnailColor, Number(normalizedSettings.thumbQuality ?? 256) as 128 | 256 | 512);
  return thumbnailScheduler.enqueue({
    filePath,
    ext,
    settings: normalizedSettings,
    source,
    priority: source === "manual" ? 3 : 2,
    retries: 1,
    dedupeKey: thumbnailRequestKey(key, getThumbnailCacheEpoch(identity.path)),
  });
}

export function getThumbnailSchedulerStats() {
  return thumbnailScheduler.getStats();
}

export function cancelPendingThumbnailJobs(
  predicate?: (job: { filePath: string; ext: string; settings: RuntimeSettingsData; source: "scan" | "watch" | "manual" }) => boolean,
) {
  thumbnailScheduler.clearPending(predicate);
}
