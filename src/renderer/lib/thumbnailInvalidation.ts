import type { ThumbnailInvalidatedData } from "../../shared/types";
import type { ThumbnailIdentity } from "../../shared/thumbnailContracts";
import type { ThumbnailImageCache } from "./thumbnailImageCache";
import type { FileRecord } from "../../shared/types";

export interface ThumbnailReadyPatch {
  fileId: number;
  thumbnailPath: string;
  identity: ThumbnailIdentity;
  contentRevision: number;
}

/** Evict cache entries before callers patch renderer records to the empty state. */
export function invalidateThumbnailImages(
  event: ThumbnailInvalidatedData,
  cache: Pick<ThumbnailImageCache, "invalidate">,
): ReadonlySet<string> | null {
  if (event.kind === "all") {
    cache.invalidate();
    return null;
  }
  for (const thumbnailPath of event.thumbnailPaths) cache.invalidate(thumbnailPath);
  return new Set(event.modelPaths);
}

/** Apply only the cache path from a ready event, fenced by its content revision when supplied. */
export function applyThumbnailReadyToRecord(
  file: FileRecord,
  event: ThumbnailReadyPatch,
): FileRecord | null {
  if (file.id !== event.fileId) return null;
  if (file.path !== event.identity.path
    || file.content_revision !== event.contentRevision
    || file.content_revision !== event.identity.contentRevision) return null;
  return { ...file, thumbnail: event.thumbnailPath, thumbnail_failed: 0 };
}
