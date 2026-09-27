# Thumbnail tasks

Read [contracts C1, C3, C4](contracts.md) and the [tracker](tracker.md). T owns thumbnail generation/cache/scheduler and the new image loader. U/V own consuming UI files. F01 must finish separating the preview broker before thumbnail and viewer implementation overlap.

## T01 - Make thumbnail requests and cache identities settle correctly

**Priority:** P1. **Dependencies:** D01. **Owner:** T.

**Own:** `src/main/thumbnails.ts`, `src/main/ipc/thumbnails.ts`, `src/renderer/lib/thumbnailRenderer.ts`; new `src/main/thumbnailIdentity.ts`, `tests/product/unit/main/thumbnailRequests.test.ts`, `tests/product/e2e/thumbnail-lifecycle.e2e.ts`.

**Steps:**

1. Add red tests for cache-hit promise cleanup, missing PNG after an earlier cache hit, timeout/result races, two revisions of the same path, and repeated identical requests sharing one result.
2. Build the C4 key from indexed canonical identity, content revision, color, pixel size, and cache version. Validate the file remains indexed before generating. Use a unique attempt ID; key pending results by ID rather than path alone.
3. Remove every settled in-flight promise in `finally`, including cache hits, null/error results, cancellation, timeout, and window shutdown. A hit must verify the PNG is readable; a stale stored path falls through to generation.
4. Carry request ID/key/epoch through the hidden renderer and check them before writing/publishing. Write a temporary PNG then atomically rename. A late result cannot update an absent/newer-revision row. Apply results through D's revision-aware repository or guarded thumbnail update API.
5. Pass normalized thumbnail quality to the actual render target size. Return correct 128/256/512 pixel images, not just different setting labels. The coordinator adds the existing quality setting to runtime payload validation.
6. Emit thumbnail-ready data containing path and identity/revision metadata, never a data URL. Ensure manual requests use the caller's normalized color/quality instead of silently substituting defaults.

**Acceptance:** After any settled request, no retained promise can return a path to a later-deleted PNG. Same-key requests dedupe; different revisions/settings cannot poison each other. Output dimensions and colors reflect the request. Every timeout/close path settles exactly once.

**Verify:** Type, Unit, Build, Product with the actual hidden renderer. Capture PNG existence/dimensions and result-registry counts; do not rely only on mocked cache calls.

## T02 - Make refresh, clear, and cache-version reset authoritative

**Priority:** P1. **Dependencies:** T01. **Owner:** T.

**Own:** `src/main/thumbnails.ts`, `src/main/thumbnailCacheLifecycle.ts`, thumbnail lifecycle tests. S applies the small replacement of thumbnail reset logic in `src/main/ipc/scanning.ts` with calls to the T-owned service; T does not independently edit that file.

**Steps:**

1. Add failures for: generate blue, change color, refresh the folder, and require different pixels; request a cache hit, clear cache, and require a real regenerated file; upgrade cache version with database thumbnail paths still present.
2. Create one invalidation operation for all/folder/selected-file scopes, using canonical containment including virtual entries. Increment the scope/file epoch, cancel affected pending work, clear database references/failure state, and delete affected physical files before new results can publish.
3. Fence active old work with its epoch/key. A result arriving after clear/refresh is discarded and cannot resurrect a stale image. Ensure an unrelated folder's thumbnails remain intact.
4. Reconcile cache-version changes and missing files with database references at startup. Await reconciliation before using old paths or queuing work that can race deletion. Regenerate incrementally; do not block startup on rendering the whole cache.
5. Route existing refresh/clear entry points to this service. Notify T03's image cache through a typed invalidation event and send current ready paths when regenerated.

**Acceptance:** Folder refresh changes output after a color/quality change. Clear followed by any previously cached request produces an existing current PNG. Startup does not retain database pointers to version-reset files. Stale active jobs never reverse an invalidation.

**Verify:** Type, Unit, Product; actual file bytes/paths before and after invalidation, targeted-folder isolation, and a barrier-controlled late-result test.

## T03 - Keep file state path-only and share thumbnail reads

**Priority:** P1. **Dependencies:** F01, F02. **Owner:** T.

**Own:** new `src/renderer/components/ThumbnailImage.tsx`, `src/renderer/lib/thumbnailImageCache.ts`, and image-cache unit tests. Provide U/V integration instructions; do not edit App/FileGrid/ComparePanel/PreviewPanel.

**Steps:**

1. Add tests proving `readThumbnail` receives an allowed path exactly once for concurrent consumers, never a `data:image/...` string. Cover null/missing/failed reads, cache invalidation, unmount, and path change while a read is pending.
2. Build one component/hook that accepts cache path plus optional identity, performs the main-approved read, and keeps data URL state internal. Use C4's bounded entry/byte LRU and in-flight dedupe. Errors render the same-size placeholder rather than throw an unhandled promise rejection.
3. Ignore late results for replaced paths/unmounted consumers. Clearing the cache must invalidate both completed and in-flight entries; old completions cannot repopulate an invalidated key.
4. Return accessible image/placeholder semantics without duplicating the card's spoken filename unnecessarily. Respect existing CSS dimensions; do not cause layout shifts while images arrive.
5. Provide the exact App event update (`thumbnail = thumbnailPath`, identity guarded) and FileGrid/archive-sample/ComparePanel replacement instructions to U01. V may reuse the component in owned surfaces.

**Acceptance:** A generation event can lead to a visible image with one path-to-image conversion. Repeated card mounts share reads within the LRU limits, and an evicted/missing image can be retried. A data URL never enters a `FileRecord`.

**Verify:** Type and meaningful cache units. Runtime acceptance is jointly verified by U01's thumbnail-arrival E2E; T03's handoff must explicitly name that remaining consumer integration.

## T04 - Centralize thumbnail queue state, controls, and retry accounting

**Priority:** P2. **Dependencies:** T02. **Owner:** T.

**Own:** `src/main/thumbnailJobScheduler.ts`, `src/main/thumbnails.ts`, `tests/product/unit/main/thumbnailScheduler.test.ts`; new `tests/product/e2e/thumbnail-controls.e2e.ts`.

**Steps:**

1. Add tests for multiple queue-start calls, priority order, same-key dedupe, pause while active, cancellation while queued, timeout/null-result retry, and explicit retry of only failed keys.
2. Replace overlapping outer background-generation loops with one coordinator over the existing scheduler. Track running/pending/success/failed/cancelled separately; cancellation is not a parse failure and does not set `thumbnail_failed`.
3. Implement C4 pause/resume/cancel semantics and C3 job snapshots. Cancelled/invalidated active results lose publication rights immediately. Preserve manual > watch > background priority and bounded retries; ensure null failure results follow the same bounded retry policy as thrown failures where appropriate.
4. Publish coalesced progress, first/terminal events, and final partial/failed status accurately. Do not report all processed items as successfully generated. Keep bounded recent job history and clean every per-attempt registry.
5. Expose the thumbnail side of shared job IPC to U05 through coordinator wiring. Resume/retry after service restart must rebuild eligible work from current indexed identities rather than resurrect old in-memory promises.

**Acceptance:** One scheduler owns generation. Pause stops starting jobs after acknowledgment; cancel settles callers; retry touches failures only. Invalidations from T02 and watcher/manual requests cannot create duplicate outer queues or stale progress.

**Verify:** Type, Unit, Product including mixed scan/watch/manual queue requests. Include final counts and active/pending registry cleanup evidence.
