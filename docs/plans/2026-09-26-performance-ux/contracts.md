# Shared implementation contracts

These are proposed defaults for the execution plan. F01 encodes these types and boundaries; later tasks implement the behavior. Preserve existing public methods until their callers have migrated. Runtime inputs are validated in main even when TypeScript already declares their shape.

## C1. File identity, writes, and revisions

- Persist a monotonic integer `content_revision` for each file. Increment it on changed mtime/size or an explicit watcher content-change event; do not increment it for tags, notes, thumbnail completion, or selection. An unchanged scan preserves it. Older scan results cannot supersede a newer watcher revision.
- Add nullable `archive_path` for virtual entries and populate it with `parseArchiveEntryPath`, never string guesses. Keep the existing `::entry::` encoding and indexed-path allowlist.
- D owns a repository API for transactional `applyIndexBatch`, `applyWatchUpdate`, and contained deletion. It prepares statements once, loads existing rows once per batch, preserves user annotations, and maintains derived scope rows in the same transaction. All mutation callers use it; metadata editing may remain a dedicated transaction in the same repository.
- Guarded scan inputs use `expectedContentRevision: 0` for an observed-absent row and a positive revision for an observed-existing row. A positive expectation cannot recreate a now-missing row, and an absent expectation cannot overwrite a newly created row. Undefined remains an unguarded legacy compatibility mode. Streaming callers also fence paths mutated while an observation was in flight, including absent/add/remove races; rejected observations have no entry in the batch's `committed` identities and must not queue enrichment or count as indexed by that job.
- Add `file_scopes(file_id, scope_path)` with a unique `(scope_path, file_id)` index and cleanup on file deletion. Scope strings come from canonical native ancestors plus virtual archive ancestors. Match `isPathContained` semantics, including sibling-prefix boundaries, Windows roots/UNC paths on Windows, archive roots, and virtual subdirectories. Index membership is an optimization for browsing, not filesystem-read authorization.
- Migration 5 adds identity/scope fields, matching sort indexes, and a persistent library revision record. Backfill scopes/archive paths in bounded batches before switching query readers; the existing browse path stays available during backfill. Updates arriving during backfill use the new writer. Startup must not silently expose an empty library or block main for one full-library transaction.
- Publish one post-commit mutation event with affected paths and flags: `rowsChanged`, `annotationsChanged`, `statsChanged`, `topologyChanged`, `thumbnailOnly`. A monotonically increasing `browseRevision` changes only when query membership/order/metadata can change. A thumbnail completion does not invalidate pagination. Separate `statsRevision` and `topologyRevision` control their caches. Coalesce renderer notifications, not database correctness.
- P04 may subscribe to committed file additions to apply pending restored annotations. Its annotation-only writes must not recursively trigger another pending-restore pass. D implements migration 6 on P04's schema request.

## C2. Page and archive semantics

Define a typed `LibraryQuery` with validated sort (`name|size|date|vertices|faces`), direction, extension, canonical folder, search, `collectionPaths: string[] | null`, limit, offset, and optional expected browse revision. `null` means no collection filter; `[]` means an empty collection and therefore zero matches.

`getLibraryPage(query)` returns either `{status: 'ok', revision, items, totalItems, totalModels, nextOffset}` or `{status: 'stale', revision}`. Counts and rows use one read snapshot. `limit` counts display items, not hidden archive members. `nextOffset` is null at the end. Sort ties use the stable item key; all scopes use the same SQL ordering, including `NOCASE` for name sorting. This intentionally removes the inconsistent JS locale sort used only in folder mode. Do not add locale-dependent cursor encodings.

`LibraryItem` is a tagged union:

- `file`: stable key `file:<id>` plus `FileRecord`.
- `archive`: stable key `archive:<canonical archive path>`, archive path/name, matching model count, aggregate metrics, and at most four thumbnail sample records. Do not put the full archive's entries into every page payload.

Collapse archives only when there is no search, no active collection, and no virtual archive folder scope, matching the existing display rule. Apply folder/extension filtering before aggregate counts. Apply sorting and pagination after grouping. Archive summaries are complete even if their members would span many model pages. Search, collection, and archive-folder queries return individual model records. Use a bounded temporary membership table or equivalent bound-data table for large collections, not a parameter per path that can exceed SQLite's variable limit. Never concatenate paths into SQL.

Preserve archive-card preview behavior: its preview target identifies the archive and the originating query, not an eagerly loaded array. The preview lazily loads entry pages through the same query service with an explicit archive scope. Next/previous loads a needed adjacent page; opening the archive folder still shows its full browsable contents. Counts describe matching members under the originating filter. U01 supplies the target; V02 owns lazy preview navigation.

The UI stores one query generation and ignores responses from older generations. Load another page through Virtuoso `endReached`; dedupe requests and item keys. If `browseRevision` changes, coalesce a refresh of the loaded range and preserve the top visible item when possible; do not append pages from different revisions. Keep existing results visible until the replacement is ready. Retry an interrupted next-page request after refresh. Thumbnail patches update loaded records without resetting pages.

Selection uses real file IDs, never synthetic archive IDs. It persists across page loads in the same scope, with selected records retained for batch actions. Clear selection on folder/search/collection/format/sort change and announce the clear; keep it across thumbnail updates and same-scope refreshes, dropping IDs that are actually deleted. This avoids actions against an invisible prior query. Archive summaries open/browse; selection happens on their member records.

## C3. Scanning and background work

Discovery streams typed events: `file`, `scope-complete`, `scope-error`, and `discovery-complete`. A scope may be a physical directory or a ZIP member namespace. Scope events carry explicit `kind: directory|archive` from the scanner; a directory named `foo.zip` is not inferred to be an archive. Errors include root/path, phase, and reason; an error is never converted into an empty successful listing.

Pruning requires affirmative complete enumeration of that scope. An unavailable root retains all indexed records. An unreadable child retains its entire old subtree, while a successfully enumerated sibling may prune missing files. A successfully enumerated parent may prove that a previously indexed child directory or archive was deleted. A corrupt/unreadable existing ZIP does not prove its members disappeared. Cancellation performs no further pruning. Only rows belonging to the scan's starting generation and not superseded by a newer watcher update are prune candidates.

One scan job is active per canonical root. Coalesce duplicate requests and serialize overlapping parent/child roots; unrelated roots may be queued independently. Overlapping scopes cannot prune each other's active work. After each bounded batch commit, emit list changes at most four times per second, plus immediate first-batch and terminal events. Metadata failures preserve tags/notes and report failed enrichment rather than deleting the discovered row.

Discovery, indexing, and thumbnail work have separate counters. Use indeterminate progress while discovery total is unknown. A `BackgroundJob` snapshot contains `jobId`, `kind: scan|thumbnail`, root/scope, `state: queued|running|pausing|paused|cancelling|cancelled|completed|partial|failed`, discovered/indexed/thumbnail success/failure/pending counts, and structured error summaries. Never call failures "generated".

Metadata completion and failure have separate `metadataCompleted` / `metadataFailed` counters, initialized to zero. The compatibility `ScanProgressData.total` (and file-indexed total when emitted during discovery) is explicitly `null` until discovery finishes; consumers derive indeterminate state from null rather than fabricating a denominator. S02 includes the minimal existing-progress callback adaptation needed to display that honestly; U05 still owns the full background-job UI.

`getBackgroundJobs`, `onBackgroundJobChanged`, `pauseJob`, `resumeJob`, `cancelJob`, and `retryJobFailures` route to the owning scan or thumbnail service. Pause stops new work after the current bounded unit settles. Cancel stops discovery, terminates owned extraction work, drops queued work, and settles once; rows already committed remain usable. Scan cancellation never prunes incomplete scopes. Explicit retries target failed scopes/files only. No delayed completion timer can hide a newer active job. Thumbnail cancellation semantics are defined in C4.

The renderer's normalized `watch` setting is authoritative. Scan completion never starts a watcher unconditionally. Watcher reconfiguration depends only on root list, watch enablement, and watcher settings, not page size or thumbnail color. On an explicitly offline root, watcher delete events are not enough to mass-delete that root; verify availability/reconcile before pruning. Ordinary confirmed single-file removal in an available root remains supported.

## C4. Thumbnail identity and delivery

`FileRecord.thumbnail` and `ThumbnailReadyData.thumbnailPath` contain only an absolute cache-file path or null. Data URLs live only inside the image-loading component/cache. Never place a data URL in file state, SQLite, or a path-based read request.

The cache key includes canonical model/virtual path, content revision, normalized thumbnail color, requested 128/256/512 pixel size, and renderer/cache version. Each attempt additionally has a unique request ID and cache epoch. Dedupe only identical keys, not every request for the same path. A cache hit checks file existence and readable output. Settled promises leave the in-flight map in `finally`, on every outcome.

Clear/refresh increments the appropriate epoch, cancels pending jobs, invalidates current cache identities and database paths, removes the affected files, and queues current-identity work. Late results cannot recreate an invalidated path or update a newer file revision. Publish a temporary output using atomic rename only after validating the result request/key/epoch. Cache-version reconciliation clears stale DB references as well as PNG files before reuse.

One thumbnail coordinator owns the queue. Pause does not report complete and does not discard pending work. Cancel settles pending consumers with a typed cancellation result; finish or terminate the active job at a safe boundary and discard its stale publication. Timeouts/failures are separate from user cancellation. Bound automatic retries to one retry for a retryable failure; explicit retry resets only the targeted failures. Maintain existing manual-before-watch-before-background priority.

T02 uses one invalidation service with discriminated scopes `{kind: "all"}`, `{kind: "folder", folderPath}`, or `{kind: "files", modelPaths}`. Its renderer notification is `{kind: "all"}` or `{kind: "paths", modelPaths, thumbnailPaths}`; each selective array contains at most 256 entries per event. Cache paths are absolute paths, never data URLs. U01 invalidates T03's image cache before clearing matching loaded/selected/preview thumbnail fields. This event does not change browse revision, selection, or scroll. A later ready event also invalidates its cache path before patching, even when that path is unchanged. S owns the existing scan-module clear/refresh adapter; T owns the service and typed event.

T03's image loader has a bounded LRU cache (maximum 128 entries and approximately 16 MiB of encoded image data), dedupes simultaneous reads, ignores late completions after unmount/path changes, and shows a stable placeholder on missing/error. Evict using recency and encoded-byte accounting. It exposes an invalidation entry point and never bypasses the main-process path check. Direct custom-protocol image serving is not required for this fix.

## C5. Preview ownership, cancellation, and rendering

A viewer instance owns its renderer, scene, controls, resources, pending frame, and monotonically changing load token. `initViewer` returns a session handle; async work uses the captured session/token and never writes to a newer global viewer. Dispose is idempotent and invalidates all old work.

Preview geometry identity is `(file ID/path, extension, content revision)`. Tags, notes, collection membership, and thumbnail arrival do not reload geometry or reset the camera. Preview color is an in-place material update using the preview-color setting; thumbnail color affects thumbnail output only. Wireframe, grid, background, resize, camera fitting, part visibility, and controls invalidate a frame.

Render on demand. Damped camera movement may schedule frames until controls settle. There is no perpetual idle animation loop. Pause visible-viewer scheduling when hidden/minimized and render one catch-up frame on return. The visible BrowserWindow uses ordinary background throttling; dedicated hidden rendering windows retain the settings necessary for background work. Explicit capture requests still render a fresh frame.

Use an explicit `requestId` created by the renderer strategy and `requestPreviewParse({requestId, path, extension, contentRevision})` plus `cancelPreviewParse(requestId)`. The AbortSignal stays within the renderer; send a typed cancel message across IPC. Bind IDs/ports to the requesting webContents. Every completion/error/cancel/timeout/window-close path closes ports, clears timers/maps/listeners, and settles exactly once. An unrelated renderer cannot cancel or adopt a request.

3MF parsing remains DOM-capable, but gets a dedicated lazy hidden preview window, separate from the thumbnail renderer. Keep at most one active preview parse and the latest requested replacement. Destroy/recreate that owned preview window to interrupt a synchronous obsolete parse; do not terminate the thumbnail window. Verify actual old-process work stops. A stale result may never be built or displayed. Retain the lightweight parser's conservative eligibility and ThreeMFLoader fallback. Do not move DOM-dependent fallback into a plain Worker.

Background preparation produces a `PreparedPreview` containing transferable mesh data, orientation transform, bounds, and optional measurement metadata. Orientation and expensive normal preparation run where geometry is parsed; compute orientation once, without mutating detached transferred arrays later. Preview and thumbnails consume the same pure orientation/preparation rules. Geometry assembly yields based on a time/vertex budget, not just every N meshes, and checks cancellation after every await/chunk. A huge single mesh is part of the test set.

The first usable model frame resolves preview loading. Part thumbnails are subsequent cancellable work at 128 x 128, generated only for visible/near-visible parts using a separate small render target or renderer. They do not mutate the live camera/visibility or synchronously read the full-size viewer canvas. Release their resources on replacement/disposal.

## C6. Measurement meaning

Persist versioned measurements in the existing dimensions JSON field: version, x/y/z, unit (`mm` or `model-unit`), basis (`source-build`), and status/reason when unavailable. Legacy bare x/y/z values display as unverified until refreshed. Re-enrich unchanged files when the measurement version is old; do not invalidate their thumbnail or annotations just for that refresh.

3MF dimensions mean the source build's axis-aligned bounds after component/build transforms and declared unit conversion to millimeters, before Polytray's display orientation/centering/normalization. Apply units exactly once. Repeated instances contribute transformed bounds; unused resource objects do not. The existing conservative fast-parser support gate may return unavailable for unsupported structures rather than invent dimensions. A successful fallback preview may supply verified source-build bounds asynchronously when its units/transform provenance is known; otherwise keep unavailable explicit.

STL and OBJ have model units, not an assumed millimeter guarantee. Label them accordingly. Zero thickness on a flat mesh is valid. Reject nonfinite/malformed dimensions. Use "File size" for bytes and "Dimensions" for x/y/z; do not label bytes "Volume". Preview and compare use the same formatter and provenance semantics.

## C7. Narrow windows and keyboard behavior

At widths where `sidebar + 400px browse area + 320px preview` fit, dock the preview and clamp its width to preserve that browse minimum. Use a 360px preferred preview width, with stored user sizes clamped after resize. At narrower widths, preview overlays the content area without relaying out the grid to zero width. Keep the sidebar usable and provide an explicit close action. Expanded preview remains an explicit separate mode. Persist sidebar/preview preferences with normalized bounds, not transient clamped values.

Use a roving focus model for the virtualized card grid. Arrows move by actual column count, Home/End move to the first/last loaded item, and PageUp/PageDown move one visible page. Reaching a page edge can load the next page and restore focus by stable key. Enter/Space opens preview when not in multi-select mode; in multi-select mode Space toggles the focused file and Enter previews it. Archive summaries open their preview and are not batch selectable. Modifier-click behavior remains supported.

Folder trees expose named, focusable controls and expanded/selected state; arrows navigate/collapse/expand. Escape closes only the topmost active dialog/overlay, never all layers at once or a preview underneath an editing dialog. On close, focus returns to the invoking control when it still exists. Form fields retain normal editing keys. Announce changed result/selection counts and pending/error states without announcing each individual background file.

## C8. Slicer handoff

V1 supports one configured local application and a default-application fallback, with no shell command text or arbitrary argument templates. The user picks the application through a native picker. On macOS launch an application bundle using the platform launcher with an argument array; on Windows/Linux spawn the selected executable with the model path as a separate argument and `shell: false`. Do not guess installed slicer names.

Only explicit user activation opens a model. Validate an indexed source and supported extension. For a ZIP entry, extract only that exact entry to an application-owned temporary directory, using a generated filename with the model extension. Reject traversal, absolute names, symlink entries, mismatched members, and sources no longer present in the index. Stream extraction with cancellation; bound the selected entry to 1 GiB uncompressed for v1 and report a clear size-limit error above it. Do not extract the whole archive or overwrite the source.

Keep successful handoff files until a later startup cleanup of files older than 24 hours, so the receiving app can read them. Clean cancelled/failed partial files immediately; cleanup touches only the app-owned handoff directory. Show success/error locally. Tests mock launching; they never start a real slicer.

## C9. Metadata export and restore

Export a version-1 JSON document through a native save dialog. Include format/version, export timestamp/app version, annotations keyed by canonical file/virtual identity (tags, notes, existing print status), normalized collections, library roots, and portable preferences. Include unresolved pending annotations in a separate required `pendingAnnotations` array (empty by default). Each annotation array has unique canonical paths; a path may appear once in both arrays to preserve different current and pending values. For archive-backed identity, canonicalize the physical archive path but preserve its encoded ZIP member identifier: member names are opaque keys, and `a/../parts/model.stl` can be a different entry from `parts/model.stl`. Folder-scope containment normalization is not identity normalization. Preserve foreign absolute pending paths without anchoring them to this host's working directory; reject ambiguous relative identities. Export does not merge those values. Import treats a missing pending array as empty for compatibility, applies the documented merge/conflict policy, and counts both arrays toward limits. Exclude model bytes, cache paths, SQLite IDs, transient jobs, executable/slicer paths, and system-specific window sizes. Explain that it is a metadata backup and source models are not included.

Import first validates and previews a deterministic plan. For v1 accept at most 50 MiB and 250k annotation entries, reporting limits before any mutation. Unknown future versions or malformed data fail without changes. No arbitrary SQL, native executable configuration, or commands are imported. Never infer a cross-machine path mapping; report unmatched paths, retain their annotations as pending, and allow a later explicit retry after the appropriate roots have been indexed.

Default import policy is **merge**: union normalized tags and collection membership; fill blank notes and absent/default `Not Printed` status; preserve different existing nonempty notes/nondefault status and report conflicts for review. Same collection ID/name merges; a colliding ID with a different name receives a newly generated ID fixed in the preview plan. Do not duplicate that collection on a retry of the same import. Settings and root-list replacement are optional unchecked choices in the preview. Restoring roots does not immediately scan or start watching; the user initiates scanning and the current watch setting remains authoritative.

Import merges the two incoming annotation arrays deterministically into one effective update per canonical destination: current target values first, imported indexed values next, imported pending values last under the same conflict policy. A currently indexed path targets its indexed row; other paths target pending storage. Unrelated current pending rows remain intact. Keep source provenance separately from these unique apply updates. The plan's local-settings before/after snapshots retain the complete normalized current settings; checked replacement overlays portable imported keys only. Plan freshness uses D01's real durable browse revision plus the renderer revision, not a fabricated annotation counter. P04 must advance that DB revision for pending-annotation mutations as well as indexed annotation changes.

Prepare and persist an import journal with before/after normalized local state and affected annotation values. Main commits annotation/pending changes and a `database-applied` transaction marker in one SQLite transaction; renderer applies the staged localStorage state, then acknowledges completion. Startup recovery follows a fixed rule before scan/watch: no committed database marker means abort the prepared import with no changes; a committed marker means roll forward to the recorded after-state, repeat localStorage writes idempotently, and acknowledge. Do not guess from the file journal alone whether SQLite committed. If recovery data is corrupt or cannot be applied, retain the recovery backup/journal, show the error, and keep automatic mutations gated. Keep a pre-import recovery backup and use an idempotent transaction ID. Do not declare success until both persistence stores agree. Explicit cancel before commit changes nothing; undo after commit is a separate restore from the recovery backup. This is local recovery, not distributed sync.

## C10. Measurement and validation targets

These numeric values are initial acceptance targets to test on recorded hardware, not claims that the current app meets them. F02 records repeatable baselines. G02 must report failures and proposed remedies; it cannot quietly loosen budgets to make a run pass.

| Workload | Target / invariant |
| --- | --- |
| Warm folder query, 10k / 50k models, 500-item page | Median <=50 / <=150 ms; 50k p95 <=250 ms on the recorded reference machine, with count and archive grouping included |
| Same query while heartbeat runs in main | No multi-second main-process stall; max heartbeat gap <=250 ms in the bounded reference test |
| Cold synthetic 5k-file scan on local storage | First committed visible batch <=1 second, and always before a deliberately delayed second subtree finishes enumeration |
| Scan steady state | Main heartbeat max gap <=250 ms (temporary Windows acceptance <=400 ms; see dated exception below); queue depth stays within documented bounds; progress publication <=4 Hz plus boundary events |
| Settled visible preview | Zero renderer frames during a one-second quiet interval after controls settle; test frame scheduling directly as well as sampled draw calls |
| Dense synthetic preview | No orientation/normal loop on the visible renderer; cooperative build slices target <=8 ms, with CPU long-task max <=100 ms on reference hardware; separately record GPU upload/driver limits |
| Preview replacement/cancel | Old request immediately loses publication rights; ports/timers settle; obsolete owned parser stops within 500 ms in the cancellation fixture |
| Multipart model | Usable first frame precedes part-image completion; no full-canvas PNG work in that critical path |
| 900 x 600 / 1280 x 800 / 1920 x 1080 | Browsing remains nonzero and usable; docked browse width >=400px; overlay controls reachable at minimum size |

Use five warmups and at least 20 measured query samples, median/p95, fixture shape, runtime versions, and machine/OS information. CI gates deterministic correctness/resource invariants on all supported platforms. Numeric reference performance runs must be recorded separately from less stable shared-runner timing; establish CI timing thresholds from repeated runner measurements in G02, without changing reference targets. Real `base.3mf` remains an optional supplementary run; portable dense and multipart fixtures are mandatory.

### October 1, 2026: temporary Windows scan exception

The user explicitly accepts a **<=400ms maximum main-heartbeat gap during Windows
scans** while DB-WORKER-01 is deferred. macOS/Linux remain <=250ms. This applies to
the 5k streaming scan and large-OBJ metadata scan heartbeat assertions, including
failure diagnostics. The same-query heartbeat row, query p95 <=250ms, first-visible
batch <=1s, preview cancellation <=500ms, queue bounds and all other targets are
unchanged. The long-term scan goal remains <=250ms on recorded reference hardware.

The Windows baseline in [run 36959173713](https://github.com/cybermaak/polytray/actions/runs/36959173713)
measured 372.16ms maximum heartbeat and 17,468ms scan time after release, with exactly
5,000 persisted rows. It fits the new temporary criterion; the 357.45ms transaction
boundary is a different metric. This is an acceptance-policy decision, not a database
performance fix or a retroactive CI pass. The 952.68ms (approximately 953ms) outlier
in [36878833124](https://github.com/cybermaak/polytray/actions/runs/36878833124) and
1,672ms in [36786572780](https://github.com/cybermaak/polytray/actions/runs/36786572780)
remain recorded and exceed even the temporary limit. All historical red runs stay red.
Default SQLite/checkpoint behavior is retained; WAL128 remains rejected.

Architecture follow-up: [DB-WORKER-01 brief](../2026-10-01-db-worker-01-brief.md).
Current disposition and evidence: [restart tracker](../2026-09-30-execution-reset-tracker.md).
