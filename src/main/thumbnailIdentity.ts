import crypto from 'node:crypto';
import path from 'node:path';
import type { ThumbnailAttempt, ThumbnailCacheKey, ThumbnailIdentity, ThumbnailSize } from '../shared/thumbnailContracts';
import { isArchiveEntryPath } from '../shared/archivePaths';

export const THUMBNAIL_RENDERER_VERSION = 'thumbnail-renderer-v2';

export function canonicalizeThumbnailPath(filePath: string): string {
  return isArchiveEntryPath(filePath) ? filePath : path.resolve(filePath);
}

export function createThumbnailIdentity(
  filePath: string,
  contentRevision: number,
  color: string,
  size: ThumbnailSize,
  rendererVersion = THUMBNAIL_RENDERER_VERSION,
): { identity: ThumbnailIdentity; cacheKey: ThumbnailCacheKey; key: string } {
  const canonicalPath = canonicalizeThumbnailPath(filePath);
  const identity: ThumbnailIdentity = {
    path: canonicalPath,
    contentRevision,
    color: color.trim().toLowerCase(),
    size,
    rendererVersion,
  };
  const cacheKey: ThumbnailCacheKey = { ...identity, canonicalPath };
  return { identity, cacheKey, key: JSON.stringify(cacheKey) };
}

export function thumbnailCacheFilename(key: string): string {
  return `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.png`;
}

export function createThumbnailRequestRegistry<T>() {
  const requests = new Map<string, Promise<T>>();
  return {
    get size() { return requests.size; },
    run(key: string, work: () => Promise<T>): Promise<T> {
      const existing = requests.get(key);
      if (existing) return existing;
      const promise = Promise.resolve().then(work).finally(() => {
        if (requests.get(key) === promise) requests.delete(key);
      });
      requests.set(key, promise);
      return promise;
    },
  };
}

export function createThumbnailAttemptRegistry<T>() {
  const attempts = new Map<string, { attempt: ThumbnailAttempt; settle: (value: T) => void }>();
  return {
    get size() { return attempts.size; },
    register(attempt: ThumbnailAttempt, settle: (value: T) => void) {
      attempts.set(attempt.requestId, { attempt, settle });
    },
    settle(requestId: string, value: T): boolean {
      const current = attempts.get(requestId);
      if (!current) return false;
      attempts.delete(requestId);
      current.settle(value);
      return true;
    },
    settleWhere(predicate: (attempt: ThumbnailAttempt) => boolean, value: T) {
      let settled = 0;
      for (const [id, current] of [...attempts.entries()]) {
        if (predicate(current.attempt) && this.settle(id, value)) settled++;
      }
      return settled;
    },
    get(requestId: string) { return attempts.get(requestId)?.attempt ?? null; },
    clear(value: T) {
      for (const id of [...attempts.keys()]) this.settle(id, value);
    },
  };
}
