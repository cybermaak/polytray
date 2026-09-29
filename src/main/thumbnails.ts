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
import { filterContainedPaths, isPathContained } from "./pathContainment";
import { createThumbnailJobScheduler, createThumbnailProgressEvent, ThumbnailJobCancelledError } from "./thumbnailJobScheduler";
import type { BackgroundJob } from "../shared/backgroundJobs";
import type { ThumbnailJobRequest as SharedThumbnailJobRequest, ThumbnailJobResult } from "../shared/backgroundJobs";
import {
  createThumbnailCacheEpochStore,
  createThumbnailInvalidationQueue,
  createThumbnailCacheReadQuarantine,
  executeThumbnailInvalidation,
  normalizeThumbnailInvalidationScope,
  readThumbnailRequestEpoch,
  readUnquarantinedThumbnailCache,
  resolveThumbnailCacheLookup,
  removeThumbnailCacheFiles,
  reconcileThumbnailCache,
  selectThumbnailRowsForInvalidation,
  selectThumbnailCachePathsToRemove,
  type ThumbnailInvalidationScope,
} from "./thumbnailCacheLifecycle";
import { parseRuntimeSettings } from "./ipc/runtimeValidation";
import { canonicalizeThumbnailPath, createThumbnailAttemptRegistry, createThumbnailIdentity, createThumbnailRequestRegistry, readValidatedThumbnailCache, thumbnailCacheFilename, thumbnailRequestKey } from "./thumbnailIdentity";
import type { ThumbnailAttempt } from "../shared/thumbnailContracts";

let thumbnailDir: string | null = null;
const pendingRequests = createThumbnailAttemptRegistry<string | null>();
const inflightPromises = createThumbnailRequestRegistry<string | null>();
const cacheEpochs = createThumbnailCacheEpochStore();
const thumbnailInvalidationQueue = createThumbnailInvalidationQueue();
const thumbnailReadQuarantine = createThumbnailCacheReadQuarantine();
let thumbnailCacheReady: Promise<void> = Promise.resolve();
let isolatedThumbnailGenerationGateUsed = false;

async function waitForIsolatedThumbnailGenerationGate(filePath: string): Promise<boolean> {
  if (process.env.POLYTRAY_ISOLATED_TEST !== "1" || isolatedThumbnailGenerationGateUsed) return false;
  const scratchEnv = process.env.POLYTRAY_PERF_SCRATCH;
  const targetEnv = process.env.POLYTRAY_THUMBNAIL_TEST_TARGET_PATH;
  if (!scratchEnv || !path.isAbsolute(scratchEnv) || !targetEnv || !path.isAbsolute(targetEnv)) return false;

  let scratchRoot: string;
  try {
    scratchRoot = fsSync.realpathSync(scratchEnv);
    if (!fsSync.statSync(scratchRoot).isDirectory()) return false;
  } catch { return false; }

  let targetPath: string;
  let canonicalJobPath: string;
  try {
    targetPath = fsSync.realpathSync(path.resolve(targetEnv));
    canonicalJobPath = fsSync.realpathSync(path.resolve(filePath));
  } catch { return false; }
  if (targetPath !== canonicalJobPath || !isPathContained(scratchRoot, targetPath)) return false;

  const holdPath = path.join(scratchRoot, "thumbnail-generation-hold");
  const reachedPath = path.join(scratchRoot, "thumbnail-generation-reached");
  const releasePath = path.join(scratchRoot, "thumbnail-generation-release");
  const isScratchRegularFile = (candidate: string) => {
    if (!isPathContained(scratchRoot, candidate)) return false;
    try {
      const entry = fsSync.lstatSync(candidate);
      return entry.isFile() && !entry.isSymbolicLink() && isPathContained(scratchRoot, fsSync.realpathSync(candidate));
    } catch { return false; }
  };
  if (!isScratchRegularFile(holdPath)) return false;

  isolatedThumbnailGenerationGateUsed = true;
  try { fsSync.writeFileSync(reachedPath, "thumbnail generation reached isolated test gate", { flag: "wx" }); }
  catch { isolatedThumbnailGenerationGateUsed = false; return false; }

  const deadline = Date.now() + 30_000;
  while (!isScratchRegularFile(releasePath)) {
    if (Date.now() >= deadline) throw new Error("Isolated thumbnail generation gate timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

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
      await waitForThumbnailCacheReady();
      const identity = createFileIndexRepository(getDb()).getFileIdentityByPath(job.filePath);
      if (!identity) throw new ThumbnailJobCancelledError();
      const scheduledEpoch = job.dedupeKey ? readThumbnailRequestEpoch(job.dedupeKey) : null;
      if (job.dedupeKey && scheduledEpoch === null) throw new ThumbnailJobCancelledError();
      const identityKey = createThumbnailIdentity(
        identity.path,
        identity.contentRevision,
        job.settings.thumbnailColor,
        Number(job.settings.thumbQuality ?? 256) as 128 | 256 | 512,
      ).key;
      if (job.dedupeKey && job.dedupeKey !== thumbnailRequestKey(identityKey, scheduledEpoch!)) throw new ThumbnailJobCancelledError();
      if (process.env.POLYTRAY_ISOLATED_TEST === "1") await waitForIsolatedThumbnailGenerationGate(job.filePath);
      const thumbnailPath = await generateThumbnail(job.filePath, job.ext, job.settings, scheduledEpoch ?? undefined, job.controller.signal);
      const current = createFileIndexRepository(getDb()).getFileIdentityByPath(job.filePath);
      if (job.controller.signal.aborted || !thumbnailPath && (!current || current.id !== identity.id || current.contentRevision !== identity.contentRevision || getThumbnailCacheEpoch(identity.path) !== (scheduledEpoch ?? getThumbnailCacheEpoch(identity.path)))) {
        throw new ThumbnailJobCancelledError();
      }
      return thumbnailPath;
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
  const next = cacheEpochs.advance([canonicalPath]);
  pendingRequests.settleWhere((attempt) => attempt.key.canonicalPath === canonicalPath, null);
  return next;
}

export function getThumbnailCacheEpoch(filePath: string): number {
  return cacheEpochs.current(filePath);
}

export function isThumbnailCacheEpochCurrent(filePath: string, expectedEpoch: number): boolean {
  return getThumbnailCacheEpoch(filePath) === expectedEpoch;
}

export function waitForThumbnailCacheReady(): Promise<void> {
  return thumbnailCacheReady;
}

export function isThumbnailCachePathQuarantined(filePath: string): boolean {
  if (thumbnailReadQuarantine.isPathQuarantined(filePath)) return true;
  if (!thumbnailReadQuarantine.isGloballyQuarantined()) return false;
  const row = getDb().prepare("SELECT 1 FROM files WHERE thumbnail = ? LIMIT 1").get(path.resolve(filePath));
  return !row;
}

export async function readThumbnailCacheBytes(filePath: string): Promise<Buffer | null> {
  await waitForThumbnailCacheReady();
  if (!isPathContained(getThumbnailDir(), filePath)) return null;
  return readUnquarantinedThumbnailCache(filePath, {
    beginRead: (cachePath) => thumbnailReadQuarantine.beginRead(cachePath),
    finishRead: (cachePath) => thumbnailReadQuarantine.finishRead(cachePath),
    readEpoch: (cachePath) => thumbnailReadQuarantine.readEpoch(cachePath),
    isQuarantined: isThumbnailCachePathQuarantined,
  });
}

/**
 * Initializes the thumbnail service by setting up a global IPC listener.
 */
export function initThumbnailService() {
  const db = getDb();
  thumbnailCacheReady = reconcileThumbnailCache({
    thumbnailDir: getThumbnailDir(),
    referencedThumbnailPaths: (
      db.prepare("SELECT thumbnail FROM files WHERE thumbnail IS NOT NULL").all() as Array<{ thumbnail: string }>
    ).map((row) => row.thumbnail),
  }).then((result) => {
    if (result.thumbnailPathsToClear.length === 0) return;
    const clearReference = db.prepare("UPDATE files SET thumbnail = NULL, thumbnail_failed = 0 WHERE thumbnail = ?");
    db.transaction((paths: string[]) => {
      for (const thumbnailPath of paths) clearReference.run(thumbnailPath);
    })(result.thumbnailPathsToClear);
  });
  void thumbnailCacheReady.catch((error) => {
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
        getThumbnailCacheEpoch(attempt.key.canonicalPath) !== attempt.cacheEpoch) {
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
          getThumbnailCacheEpoch(attempt.key.canonicalPath) !== attempt.cacheEpoch) {
        await fs.rm(temporaryPath, { force: true });
      } else {
        await fs.rename(temporaryPath, thumbPath);
        const afterRename = getDb().prepare("SELECT path, content_revision FROM files WHERE id = ?").get(row.id) as { path: string; content_revision: number } | undefined;
        if (!afterRename || afterRename.path !== attempt.key.canonicalPath || afterRename.content_revision !== attempt.key.contentRevision ||
            getThumbnailCacheEpoch(attempt.key.canonicalPath) !== attempt.cacheEpoch) {
          await fs.rm(thumbPath, { force: true });
        } else {
          thumbnailReadQuarantine.markFresh(thumbPath);
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
  expectedCacheEpoch?: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return null;
  await waitForThumbnailCacheReady();
  const db = getDb();
  const identityRow = db.prepare("SELECT id, path, content_revision, thumbnail FROM files WHERE path = ?").get(filePath) as { id: number; path: string; content_revision: number; thumbnail: string | null } | undefined;
  if (!identityRow) return null;
  const size = Number(settings.thumbQuality ?? 256) as 128 | 256 | 512;
  const { cacheKey, key } = createThumbnailIdentity(identityRow.path, identityRow.content_revision, settings.thumbnailColor, size);
  const currentCacheEpoch = getThumbnailCacheEpoch(identityRow.path);
  if (expectedCacheEpoch !== undefined && expectedCacheEpoch !== currentCacheEpoch) return null;
  const cacheEpoch = expectedCacheEpoch ?? currentCacheEpoch;
  const requestKey = thumbnailRequestKey(key, cacheEpoch);
  return inflightPromises.run(requestKey, async () => {
    // 2. Check cache first
    const thumbPath = path.join(getThumbnailDir(), thumbnailCacheFilename(key));
    const isCurrentModelIdentity = () => {
      const current = db.prepare("SELECT path, content_revision FROM files WHERE id = ?").get(identityRow.id) as { path: string; content_revision: number } | undefined;
      return !!current && current.path === identityRow.path && current.content_revision === identityRow.content_revision &&
        identityRow.path === canonicalizeThumbnailPath(filePath) && getThumbnailCacheEpoch(identityRow.path) === cacheEpoch;
    };
    const cacheLookup = await resolveThumbnailCacheLookup(
      async () => {
        if (isThumbnailCachePathQuarantined(thumbPath)) return null;
        const cached = await readValidatedThumbnailCache(
        () => fs.readFile(thumbPath),
        size,
        decodeThumbnailPng,
          () => isCurrentModelIdentity() && !isThumbnailCachePathQuarantined(thumbPath),
        );
        return cached ? thumbPath : null;
      },
      isCurrentModelIdentity,
    );
    if (cacheLookup.kind === "hit") return cacheLookup.value;
    if (cacheLookup.kind === "stale") return null;
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
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const timeout = setTimeout(() => pendingRequests.settle(requestId, null), settings.thumbnail_timeout);
      const onClosed = () => pendingRequests.settle(requestId, null);
      const onAbort = () => pendingRequests.settle(requestId, null);
      pendingRequests.register(attempt, settle);
      thumbWindow.once("closed", onClosed);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { pendingRequests.settle(requestId, null); return; }
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
  await waitForThumbnailCacheReady();
  const db = getDb();
  const repository = createFileIndexRepository(db);
  const targets = filesToThumbnail.flatMap((file) => {
    const identity = repository.getFileIdentityByPath(file.path);
    if (!identity) return [];
    const expectedCacheEpoch = getThumbnailCacheEpoch(identity.path);
    const { key } = createThumbnailIdentity(identity.path, identity.contentRevision, settings.thumbnailColor, Number(settings.thumbQuality ?? 256) as 128 | 256 | 512);
    return [{ file, identity, expectedCacheEpoch, request: {
      filePath: file.path, ext: file.ext, settings, source: "scan" as const, priority: 1, retries: 1,
      dedupeKey: thumbnailRequestKey(key, expectedCacheEpoch),
    } }];
  });
  const total = targets.length;
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.THUMBNAIL_PROGRESS, {
      current: 0, total, filename: "", phase: "start", outcome: "running",
      generated: 0, failed: 0, cancelled: 0, pending: total,
    });
  }
  if (targets.length === 0) {
    const finalWin = getMainWindow();
    if (finalWin && !finalWin.isDestroyed()) finalWin.webContents.send(IPC.THUMBNAIL_PROGRESS, {
      current: 0, total, filename: "", phase: "done", outcome: "completed",
      generated: 0, failed: 0, cancelled: 0, pending: 0,
    });
    return;
  }
  const batch = thumbnailScheduler.enqueueBatch(targets.map((target) => target.request));
  const stopProgress = thumbnailScheduler.onJobChanged((job) => {
    if (job.jobId !== batch.jobId) return;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.THUMBNAIL_PROGRESS, createThumbnailProgressEvent(job, total));
  });
  try {
    await Promise.all((await batch.results).map(async ({ request, thumbnailPath, error }) => {
      const target = targets.find((candidate) => candidate.request.dedupeKey === request.dedupeKey);
      if (!target || getThumbnailCacheEpoch(target.identity.path) !== target.expectedCacheEpoch) return;
      if (thumbnailPath) {
        const update = repository.updateThumbnailState({ fileId: target.identity.id, expectedContentRevision: target.identity.contentRevision, thumbnailPath, thumbnailFailed: 0 });
        const win = getMainWindow();
        if (update.status === "updated" && win && !win.isDestroyed()) {
          const { identity } = createThumbnailIdentity(target.identity.path, target.identity.contentRevision, settings.thumbnailColor, Number(settings.thumbQuality ?? 256) as 128 | 256 | 512);
          win.webContents.send(IPC.THUMBNAIL_READY, { fileId: target.identity.id, thumbnailPath, identity, contentRevision: target.identity.contentRevision });
        }
      } else if (error?.name !== "ThumbnailJobCancelledError" && error?.name !== "AbortError") {
        repository.updateThumbnailState({ fileId: target.identity.id, expectedContentRevision: target.identity.contentRevision, thumbnailPath: null, thumbnailFailed: 1 });
        if (error) console.warn(`[Thumbnails] Failed ${target.file.path}:`, error.message);
      }
    }));
    await batch.done;
  } finally {
    stopProgress();
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
): Promise<void> {
  const normalizedSettings = parseRuntimeSettings(settings);
  return waitForThumbnailCacheReady().then(() => {
    const filesToThumbnail = getMissingThumbnailFiles(folderPath);
    scheduleThumbnailFiles(filesToThumbnail, getMainWindow, normalizedSettings);
  }).catch((error) => {
    console.warn("[Thumbnails] Cache readiness blocked thumbnail queueing:", error);
  });
}

function getMissingThumbnailFiles(folderPath: string | null, modelPaths?: string[]): ScannedFile[] {
  const db = getDb();
  const missingRows = db.prepare(
    "SELECT path, name, extension, directory, size_bytes, modified_at FROM files WHERE thumbnail IS NULL AND thumbnail_failed = 0",
  ).all() as Array<{
    path: string; name: string; extension: string; directory: string; size_bytes: number; modified_at: number;
  }>;
  const allowedPaths = modelPaths
    ? new Set(modelPaths.map(canonicalizeThumbnailPath))
    : folderPath === null ? null : new Set(filterContainedPaths(folderPath, missingRows.map((row) => row.path)));
  return missingRows
    .filter((row) => allowedPaths === null || allowedPaths.has(canonicalizeThumbnailPath(row.path)))
    .map((row) => ({ path: row.path, name: row.name, ext: row.extension, dir: row.directory, size: row.size_bytes, mtime: row.modified_at }));
}

function scheduleThumbnailFiles(
  filesToThumbnail: ScannedFile[],
  getMainWindow: () => BrowserWindow | null,
  settings: RuntimeSettingsData,
) {
  if (filesToThumbnail.length === 0) return;
  setTimeout(() => {
    void generateThumbnailsInBackground(filesToThumbnail, getMainWindow, settings).catch((error) => {
      console.warn("[Thumbnails] Background generation failed:", error);
    });
  }, 500);
}

function queueThumbnailGenerationForPaths(
  modelPaths: string[],
  getMainWindow: () => BrowserWindow | null,
  settings: RuntimeSettingsData,
): Promise<void> {
  const normalizedSettings = parseRuntimeSettings(settings);
  return waitForThumbnailCacheReady().then(() => {
    scheduleThumbnailFiles(getMissingThumbnailFiles(null, modelPaths), getMainWindow, normalizedSettings);
  }).catch((error) => {
    console.warn("[Thumbnails] Cache readiness blocked thumbnail queueing:", error);
  });
}

export function scheduleSingleThumbnailGeneration(
  filePath: string,
  ext: string,
  settings: RuntimeSettingsData,
  source: "watch" | "manual",
) {
  const normalizedSettings = parseRuntimeSettings(settings);
  return waitForThumbnailCacheReady().then(() => {
    const identity = createFileIndexRepository(getDb()).getFileIdentityByPath(filePath);
    if (!identity) return null;
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
  });
}

export function getThumbnailSchedulerStats() {
  return thumbnailScheduler.getStats();
}

export async function getThumbnailBackgroundJobs(): Promise<BackgroundJob[]> {
  return thumbnailScheduler.getJobs();
}

export function onThumbnailBackgroundJobChanged(callback: (job: BackgroundJob) => void): () => void {
  return thumbnailScheduler.onJobChanged(callback);
}

/** Queues one identity-guarded request; its generated BackgroundJob ID remains separate from requestId. */
export async function enqueueThumbnailJob(
  request: SharedThumbnailJobRequest,
  settings: RuntimeSettingsData,
): Promise<ThumbnailJobResult> {
  await waitForThumbnailCacheReady();
  const db = getDb();
  const identity = createFileIndexRepository(db).getFileIdentityByPath(request.path);
  const staleIdentity: ThumbnailJobResult = {
    status: "failed",
    error: { path: request.path, phase: "thumbnail", code: "STALE_IDENTITY", message: "The indexed file identity changed before thumbnail generation.", retryable: false },
  };
  if (!identity || identity.id !== request.fileId || identity.contentRevision !== request.contentRevision) return staleIdentity;
  const extension = db.prepare("SELECT extension FROM files WHERE id = ? AND path = ? AND content_revision = ?")
    .get(identity.id, identity.path, identity.contentRevision) as { extension: string } | undefined;
  if (!extension) return staleIdentity;
  const normalizedSettings = parseRuntimeSettings(settings);
  const { key } = createThumbnailIdentity(identity.path, identity.contentRevision, normalizedSettings.thumbnailColor, Number(normalizedSettings.thumbQuality ?? 256) as 128 | 256 | 512);
  try {
    const thumbnailPath = await thumbnailScheduler.enqueue({
      filePath: identity.path,
      ext: extension.extension,
      settings: normalizedSettings,
      source: request.priority === "manual" ? "manual" : request.priority === "watch" ? "watch" : "scan",
      dedupeKey: thumbnailRequestKey(key, getThumbnailCacheEpoch(identity.path)),
    });
    if (!thumbnailPath) return {
      status: "failed",
      error: { path: identity.path, phase: "thumbnail", code: "THUMBNAIL_EMPTY", message: "Thumbnail generation returned no image.", retryable: true },
    };
    return { status: "completed", thumbnailPath };
  } catch (error) {
    if (error instanceof Error && error.name === "ThumbnailJobCancelledError") return { status: "cancelled" };
    return {
      status: "failed",
      error: { path: identity.path, phase: "thumbnail", code: "THUMBNAIL_FAILED", message: error instanceof Error ? error.message : String(error), retryable: true },
    };
  }
}

export async function pauseThumbnailJob(jobId: string): Promise<void> { await thumbnailScheduler.pause(jobId); }
export async function resumeThumbnailJob(jobId: string): Promise<void> { await thumbnailScheduler.resume(jobId); }
export async function cancelThumbnailJob(jobId: string): Promise<void> { await thumbnailScheduler.cancel(jobId); }
export async function retryThumbnailJobFailures(jobId: string): Promise<void> { await thumbnailScheduler.retryFailures(jobId); }

export function cancelPendingThumbnailJobs(
  predicate?: (job: { filePath: string; ext: string; settings: RuntimeSettingsData; source: "scan" | "watch" | "manual" }) => boolean,
) {
  thumbnailScheduler.clearPending(predicate);
}

export function invalidateThumbnails(
  scopeInput: ThumbnailInvalidationScope,
  settings: RuntimeSettingsData,
  getMainWindow: () => BrowserWindow | null,
): Promise<{ invalidatedFileCount: number; removedThumbnailCount: number }> {
  const scope = normalizeThumbnailInvalidationScope(scopeInput);
  const normalizedSettings = parseRuntimeSettings(settings);
  return thumbnailInvalidationQueue.run(async () => {
    await waitForThumbnailCacheReady();
    const db = getDb();
    const selectedRows = scope.kind === "all"
      ? []
      : selectThumbnailRowsForInvalidation(
        db.prepare("SELECT id, path, content_revision AS contentRevision, thumbnail FROM files").all() as Array<{
          id: number; path: string; contentRevision: number; thumbnail: string | null;
        }>,
        scope,
      );
    const selectedThumbnailPaths = scope.kind === "all"
      ? []
      : selectThumbnailCachePathsToRemove(getThumbnailDir(), selectedRows);

    return executeThumbnailInvalidation(scope, selectedRows, getThumbnailDir(), {
    advanceEpochs: (modelPaths, invalidateAll) => {
      if (invalidateAll) {
        cacheEpochs.advance([], true);
        thumbnailReadQuarantine.quarantineAll();
        pendingRequests.settleWhere(() => true, null);
        return;
      }
      const canonicalPaths = new Set(modelPaths.map(canonicalizeThumbnailPath));
      cacheEpochs.advance([...canonicalPaths]);
      thumbnailReadQuarantine.quarantinePaths(selectedThumbnailPaths);
      pendingRequests.settleWhere((attempt) => canonicalPaths.has(attempt.key.canonicalPath), null);
    },
    cancelQueued: (modelPaths) => {
      if (!modelPaths) {
        cancelPendingThumbnailJobs();
        return;
      }
      const canonicalPaths = new Set(modelPaths.map(canonicalizeThumbnailPath));
      cancelPendingThumbnailJobs((job) => canonicalPaths.has(canonicalizeThumbnailPath(job.filePath)));
    },
    clearReferences: async (rows, invalidateAll) => {
      if (invalidateAll) {
        return db.prepare(
          "UPDATE files SET thumbnail = NULL, thumbnail_failed = 0 WHERE thumbnail IS NOT NULL OR thumbnail_failed != 0",
        ).run().changes;
      }
      const clearRow = db.prepare(
        "UPDATE files SET thumbnail = NULL, thumbnail_failed = 0 WHERE id = ? AND path = ? AND content_revision = ?",
      );
      const clearBatch = db.transaction((batch: typeof rows) => {
        let changes = 0;
        for (const row of batch) changes += clearRow.run(row.id, row.path, row.contentRevision).changes;
        return changes;
      });
      let changes = 0;
      for (let start = 0; start < rows.length; start += 256) {
        changes += clearBatch(rows.slice(start, start + 256));
        if (start + 256 < rows.length) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return changes;
    },
    removeCacheFiles: async (invalidateAll, thumbnailPaths) => {
      const failedPaths = new Set<string>();
      try {
        const removedCount = await removeThumbnailCacheFiles(getThumbnailDir(), invalidateAll, thumbnailPaths, {
          quarantine: thumbnailReadQuarantine,
          onError: (filePath, error) => {
            failedPaths.add(path.resolve(filePath));
            console.warn("[Thumbnails] Failed to remove cached PNG:", filePath, error);
          },
        });
        if (invalidateAll) {
          const unknownFailure = failedPaths.has(path.resolve(getThumbnailDir()));
          thumbnailReadQuarantine.finishFullInvalidation([...failedPaths], failedPaths.size > 0, unknownFailure);
        } else {
          for (const filePath of thumbnailPaths) {
            if (!failedPaths.has(path.resolve(filePath))) thumbnailReadQuarantine.markRemoved(filePath);
          }
        }
        return removedCount;
      } catch (error) {
        if (invalidateAll) thumbnailReadQuarantine.finishFullInvalidation([], true, true);
        else thumbnailReadQuarantine.quarantinePaths(thumbnailPaths);
        throw error;
      }
    },
    onCacheRemoveError: (error, thumbnailPaths) => {
      if (scope.kind === "all") thumbnailReadQuarantine.finishFullInvalidation([], true, true);
      else thumbnailReadQuarantine.quarantinePaths(thumbnailPaths);
      console.warn("[Thumbnails] Cache deletion was incomplete; continuing invalidation:", error);
    },
    publish: (event) => {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      try {
        mainWindow.webContents.send(IPC.THUMBNAIL_INVALIDATED, event);
      } catch (error) {
        console.warn("[Thumbnails] Failed to publish cache invalidation:", error);
      }
    },
    queue: (invalidationScope) => invalidationScope.kind === "all"
      ? queueThumbnailGeneration(null, getMainWindow, normalizedSettings)
      : invalidationScope.kind === "folder"
        ? queueThumbnailGeneration(invalidationScope.folderPath, getMainWindow, normalizedSettings)
        : queueThumbnailGenerationForPaths(invalidationScope.modelPaths, getMainWindow, normalizedSettings),
    });
  });
}
