import test from "node:test";
import assert from "node:assert/strict";
import type { ThumbnailInvalidatedData } from "../../../../src/shared/types";
import type { ThumbnailImageCache } from "../../../../src/renderer/lib/thumbnailImageCache";
import {
  type ThumbnailReadyPatch,
  invalidateThumbnailImages,
  applyThumbnailReadyToRecord,
} from "../../../../src/renderer/lib/thumbnailInvalidation";

function cacheRecorder() {
  const paths: Array<string | undefined> = [];
  const cache = {
    invalidate: (thumbnailPath?: string) => paths.push(thumbnailPath),
  } as unknown as ThumbnailImageCache;
  return { cache, paths };
}

test("path invalidation evicts each cache path before returning affected model paths", () => {
  const { cache, paths } = cacheRecorder();
  const event: ThumbnailInvalidatedData = {
    kind: "paths",
    modelPaths: ["/models/a.stl", "/models/b.stl"],
    thumbnailPaths: ["/cache/a.png", "/cache/old-b.png"],
  };
  const affected = invalidateThumbnailImages(event, cache);
  assert.deepEqual(paths, ["/cache/a.png", "/cache/old-b.png"]);
  assert.deepEqual([...affected ?? []], event.modelPaths);
});

test("all-library invalidation clears the cache and signals every loaded model", () => {
  const { cache, paths } = cacheRecorder();
  const affected = invalidateThumbnailImages({ kind: "all" }, cache);
  assert.deepEqual(paths, [undefined]);
  assert.equal(affected, null);
});

test("thumbnail-ready patches only the matching file content revision with its cache path", () => {
  const record = {
    id: 10, path: "/models/a.stl", name: "a.stl", extension: "stl", directory: "/models",
    size_bytes: 10, modified_at: 1, vertex_count: 3, face_count: 1, thumbnail: null,
    thumbnail_failed: 1, indexed_at: 1, content_revision: 8, archive_path: null,
  };
  const event: ThumbnailReadyPatch = {
    fileId: 10,
    thumbnailPath: "/cache/a.png",
    identity: {
      path: "/models/a.stl",
      contentRevision: 8,
      color: "#8888aa",
      size: 256,
      rendererVersion: "v1",
    },
    contentRevision: 8,
  };
  assert.deepEqual(applyThumbnailReadyToRecord(record, event), {
    ...record, thumbnail: event.thumbnailPath, thumbnail_failed: 0,
  });
  assert.equal(applyThumbnailReadyToRecord(record, { ...event, contentRevision: 9 }), null);
});
