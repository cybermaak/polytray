export type ThumbnailSize = 128 | 256 | 512;

export interface ThumbnailIdentity {
  path: string;
  contentRevision: number;
  color: string;
  size: ThumbnailSize;
  rendererVersion: string;
}

export interface ThumbnailCacheKey extends ThumbnailIdentity {
  canonicalPath: string;
}

export interface ThumbnailAttempt {
  requestId: string;
  cacheEpoch: number;
  key: ThumbnailCacheKey;
}

export type ThumbnailGenerationResult =
  | { status: "ready"; requestId: string; key: ThumbnailCacheKey; thumbnailPath: string }
  | { status: "cancelled"; requestId: string; key: ThumbnailCacheKey }
  | { status: "failed"; requestId: string; key: ThumbnailCacheKey; retryable: boolean; error: string };

export interface ThumbnailJobCoordinator {
  request(identity: ThumbnailIdentity, priority: "background" | "watch" | "manual"): Promise<ThumbnailGenerationResult>;
  invalidate(path?: string): Promise<void>;
}

export type { ThumbnailJobs } from "./backgroundJobs";
