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

export function thumbnailRequestKey(cacheKey: string, cacheEpoch: number): string {
  return JSON.stringify([cacheKey, cacheEpoch]);
}

export interface ThumbnailPngDimensions {
  width: number;
  height: number;
}

export async function readValidatedThumbnailCache(
  read: () => Promise<Buffer>,
  expectedSize: ThumbnailSize,
  decode: (data: Buffer) => ThumbnailPngDimensions | null,
  isCurrent: () => boolean | Promise<boolean>,
): Promise<Buffer | null> {
  let data: Buffer;
  try {
    data = await read();
  } catch {
    return null;
  }
  if (data.length < 8 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  const dimensions = decode(data);
  if (!dimensions || dimensions.width !== expectedSize || dimensions.height !== expectedSize) return null;
  return await isCurrent() ? data : null;
}

export async function generateForCapturedThumbnailIdentity<TIdentity, TPath extends string | null>(
  lookup: () => TIdentity | null,
  generate: (identity: TIdentity) => Promise<TPath>,
  canPublish: (identity: TIdentity) => boolean | Promise<boolean>,
  publish: (identity: TIdentity, thumbnailPath: TPath) => boolean | Promise<boolean>,
): Promise<string | null> {
  const identity = lookup();
  if (!identity) return null;
  const thumbnailPath = await generate(identity);
  if (!await canPublish(identity)) return null;
  if (!await publish(identity, thumbnailPath) || thumbnailPath === null) return null;
  return thumbnailPath;
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
