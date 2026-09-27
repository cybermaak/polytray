# Foundation and data tasks

Read the [plan](../2026-09-26-performance-ux-execution-plan.md), [contracts](contracts.md), and [tracker](tracker.md). Verification labels refer to the plan's commands. Files marked new are proposed paths.

## F01 - Freeze contracts and extract the preview seam

**Priority:** prerequisite. **Dependencies:** none. **Owner:** coordinator.

**Own:** shared types/settings/runtime validation; preload root and renderer declarations; main registration/build config. For this task only, coordinate the mechanical extraction from `src/main/thumbnails.ts` and preview-specific portions of `src/renderer/lib/thumbnailRenderer.ts`; return those remaining files to T afterward.

**Read:** `src/shared/types.ts`, `src/preload/index.ts`, `src/renderer/globals.d.ts`, `src/main/thumbnails.ts`, `src/renderer/lib/previewStrategies.ts`, `src/renderer/lib/thumbnailRenderer.ts`, `src/main/ipc/runtimeValidation.ts`, `src/shared/settings.ts`.

**Steps:**

1. Recheck the baseline and local changes. List the active owners and reserve common files before dispatching another task.
2. Encode the C1-C9 contracts in focused shared modules: new `libraryQuery.ts`, `backgroundJobs.ts`, `thumbnailContracts.ts`, `previewContracts.ts`, `measurementContracts.ts`, and `backupContracts.ts`; re-export shared public types from `types.ts` as needed. Use discriminated unions and stable names from the contract. Do not invent a second settings or collection store.
3. Mechanically move the existing 3MF main broker out of `thumbnails.ts` into new `src/main/previewParseService.ts`, with window access passed as a dependency. Move the preload preview request/port registry into new `src/preload/previewBridge.ts`. Keep current exports/call behavior working. Transfer these new files to V after verification.
4. Isolate the hidden-renderer preview request handler into new `src/renderer/lib/previewParseRenderer.ts`, still invoked by the current hidden renderer initially. Preserve its current parse/serialization path. T keeps thumbnail render handling; V later moves the extracted handler to a dedicated window.
5. Publish narrow adapter interfaces: `LibraryQueryClient` for U/V, `IndexRepository` for S/P, `ThumbnailJobs` for S/U, `ScanJobs` for U, and backup/slicer service result types for U. Main registrations remain coordinator-owned. Add concrete IPC methods only when their actual handlers are integrated; no success-returning stubs or unhandled UI calls.
6. Document the intended migration reservations, common wiring requests, and ownership in the handoff. Add thumbnail quality to the runtime settings contract when T01 is integrated, using the existing 128/256/512 normalization.

**Acceptance:** Existing preview, thumbnail, and MessagePort behavior is unchanged by extraction; no duplicate result listeners or circular imports are introduced. T and V no longer need to edit the same broker/handler function. All subsequent task APIs are specified before dispatch.

**Verify:** Type, Build, existing serialization/strategy/settings/runtime-validation units, and Product because preload/launch/preview wiring moved. Record extraction parity evidence. Do not write tests just for type declarations.

## F02 - Establish portable fixtures and trustworthy diagnostics

**Priority:** prerequisite. **Dependencies:** none. **Owner:** coordinator/test owner; disjoint files from F01.

**Own:** new `tests/support/fixtures/performanceFixtures.ts`, `tests/support/helpers/performanceProbe.ts`, `tests/support/helpers/isolatedApp.ts`; small coordinated additions to existing fixture/launch helpers; new `tests/dev/performance-baseline.ts`. Do not edit production services.

**Steps:**

1. Build deterministic fixtures for 600 records, 10k/50k records with many folders and mixed sort ties, a collection containing record 600, and an archive containing more than one page of members. Populate SQLite with the in-process fixture helper, preserving legitimate schema setup.
2. Add generated normal/malformed STL/OBJ/3MF cases; a dense single-mesh fixture, a multipart fixture, 3MF component/build transforms and unit declarations, an unsupported/external-reference 3MF, and a changed-file fixture with controlled revision changes. Avoid large committed binaries.
3. Provide an isolated Electron harness using temporary userData and the existing launch-environment helper. Route diagnostic files to task scratch/temp storage, and clean only directories created by the test. Supply a mocked native launcher for P01.
4. Add controllable discovery/extraction test barriers so tests can hold a subtree or parse in flight, fail a directory listing, inject out-of-order completions, and cancel without relying on sleep timing.
5. Provide separate main heartbeat, renderer long-task, viewer-render-count, first-committed-batch, and preview-phase probes. Test-only hooks must be gated by the isolated test launch configuration and absent/inert in normal packaged operation.
6. Capture baseline query and runtime measurements with environment details. Convert observed failures into the relevant stream's later regression cases, not permanently failing default tests in this foundation task. Use event assertions/`expect.poll`, never async `waitForFunction`.

**Acceptance:** Fixtures reproduce the 500/600 visibility problem and slow folder-query shape; diagnostics distinguish draw calls from frames and CPU work from GPU time. All fixtures work without the user's external drive or `POLYTRAY_REAL_BASE_3MF_PATH`.

**Verify:** Type, fixture/helper-focused units, and an isolated Electron diagnostic smoke run. Re-run baseline samples only as needed to validate the harness. Store a concise baseline report with generated evidence paths.

## D01 - Indexed folder membership and a batched write repository

**Priority:** P1. **Dependencies:** F01, F02. **Owner:** D.

**Own:** `src/main/database.ts`, `src/main/fileIndexing.ts`; new `src/main/fileScopes.ts`, `src/main/libraryRevisions.ts`; `tests/product/unit/main/fileIndexing.test.ts`, `databaseMigrations.test.ts`, and new `fileScopes.test.ts`.

**Steps:**

1. First add failing cases for sibling-prefix containment, physical/archive ancestors, a changed file at equal timestamp, stale scan enrichment after a watcher update, annotation preservation, and mixed-case name ordering/index compatibility.
2. Append migration 5 as described in C1: content revision, archive identity, scope membership, durable revision counters, and `name COLLATE NOCASE` indexes matching the chosen query order. Add supporting scope/extension/sort indexes based on the actual D02 SQL, not one index for every imaginable combination.
3. Create and test the canonical scope enumerator. Compare its membership against the existing containment helper across native folders, virtual roots/subfolders, normalized paths, and Windows cases on Windows. Never use raw string-prefix authorization.
4. Implement restartable bounded backfill. Persist its cursor/completion state; query callers can detect readiness. Maintain new writes during backfill and never resurrect removed rows. Report startup preparation without blocking the window for a whole-library transaction.
5. Implement a prepared-statement repository with one existing-state lookup per batch, bounded transactions, consistent revision decisions, atomic scope updates, and deletion cleanup. Expose optional metadata updates tied to an expected content revision, so slow enrichment cannot overwrite a newer file.
6. Keep existing `applyScannedFileRecord`/`applyWatchedFileRecord` exports as compatible wrappers while callers migrate. Tags, notes, and existing print status survive every content upsert. Unchanged scans preserve cache identity; genuine content changes invalidate the old thumbnail reference.
7. Publish post-commit mutation information through the typed revision service. Provide S with exact repository signatures and metadata-enrichment behavior. The coordinator updates shared `FileRecord` declarations and any main startup/backfill wiring.

**Acceptance:** Migration from every supported old schema preserves all rows/annotations; interrupted backfill resumes. One write transaction maintains records and memberships together. No caller must read a row and then make the repository read the same row again. Indexed-path protocol checks remain unchanged.

**Verify:** Type, Unit with Node-native SQLite, migration matrix, contained-folder/virtual-path tests, and Build. Product after repository wrappers/startup wiring are integrated.

## D02 - Query complete display pages in SQLite

**Priority:** P1. **Dependencies:** D01. **Owner:** D.

**Own:** `src/main/ipc/files.ts`; new `src/main/libraryQueries.ts`; new `tests/product/unit/main/libraryQueries.test.ts`. Coordinator handles shared IPC/preload exposure and boundary validators.

**Steps:**

1. Add red tests for record 600, collection-only record 600, empty collection versus no collection, >one-page ZIP members, mixed archives and loose files, every sort/direction, and ties spanning a boundary.
2. Build bound-parameter queries that apply scope membership, extension, name/tag search, and collection membership before paging. Use the scope index, matching name collation, and stable secondary item key. Remove JS full-library filtering and `localeCompare` from folder queries.
3. Construct file/complete-archive display items in SQL according to C2. Counts, grouping, sort, limit, and offset belong to one query snapshot. Fetch no more than four archive thumbnail samples per returned archive; do not issue an unbounded query per archive.
4. Support collection membership via a scoped temporary/bound-data table, clear it for each request, and ensure interleaved queries cannot reuse another request's membership. Test at least 10k member paths and literal wildcard/quote characters in names/paths.
5. Implement expected-revision validation and `nextOffset`. Add a file-only archive-entry query using the same service for V02. Keep the legacy GET_FILES response available until U and V migrate; both paths use the corrected filtering/order.
6. Capture query plans and the C10 measurements. A plan using a temp sort for a grouped aggregate is not automatically a bug; demonstrate bounded main work and the required latency instead of asserting impossible index use for every grouped query.

**Acceptance:** Iterating pages returns every expected stable key exactly once for an unchanged revision. Counts are correct before the first page is shown. An archive is never split into contradictory summaries. Outdated revision requests explicitly return stale, and untrusted sort/collection input cannot become SQL text.

**Verify:** Type, Unit, Build for IPC changes, query benchmark. Product coverage is completed with U01/V02; the service task must still prove its integrated IPC contract in an isolated smoke test.

## D03 - Separate library summaries from list queries

**Priority:** P2. **Dependencies:** D02. **Owner:** D.

**Own:** `src/main/ipc/files.ts`, `src/main/libraryRevisions.ts`, new `src/main/librarySummary.ts`; new `tests/product/unit/main/librarySummary.test.ts`. Coordinator forwards typed mutation events through preload.

**Steps:**

1. Add tests counting summary and directory queries across sort/search-only changes, annotation updates, content changes, topology changes, and thumbnail completions.
2. Replace the five stats reads with one aggregate query. Cache its result by stats revision and directory topology by topology revision. Do not cache without explicit invalidation.
3. Define invalidation calls for inserts/deletes/content-size changes, annotations affecting search, folder changes, and thumbnail-only results. Wire repository writes and metadata edits; give S/T/P a documented event API for their operations.
4. Make directory arrays/reference identity stable when topology has not changed. Expose separate query methods/events so U02 does not fetch summaries as part of every list request.
5. Emit one bounded mutation notification per batch; immediate first/terminal notifications remain possible. Keep counters and invalidation synchronous with commits, even though renderer notifications are coalesced.

**Acceptance:** Sort/search/pagination and thumbnail patches perform zero stats/directory reads after a warm unchanged summary. A real insertion/deletion updates the required counts/tree exactly once per coalesced batch. Tags refresh matching search results without rebuilding topology.

**Verify:** Type, Unit; targeted IPC/event integration test; Product once U02 consumes the events.
