import type { ThumbnailInvalidatedData, ThumbnailReadyData } from "../../shared/types";
import type { ThumbnailImageCache } from "./thumbnailImageCache";
import type { FileRecord } from "../../shared/types";

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

/** Apply a ready event only when its file path and content revision still match the record. */
export function applyThumbnailReadyToRecord(
  file: FileRecord,
  event: ThumbnailReadyData,
): FileRecord | null {
  if (file.id !== event.fileId) return null;
  if (file.path !== event.identity.path
    || file.content_revision !== event.contentRevision
    || file.content_revision !== event.identity.contentRevision) return null;
  return { ...file, thumbnail: event.thumbnailPath, thumbnail_failed: 0 };
}
