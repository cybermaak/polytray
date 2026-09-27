# Scanning, metadata, and watcher tasks

Read [contracts C1, C3, C6](contracts.md), the [tracker](tracker.md), and `AGENTS.md`. S owns scanner/metadata/watcher behavior; D owns database schema and every indexing repository change.

## S01 - Require proof of successful enumeration before pruning

**Priority:** P1, data safety. **Dependencies:** F01, F02. **Owner:** S.

**Own:** `src/main/scanner.ts`, `src/main/ipc/scanning.ts`; new `src/main/scanCoverage.ts`, `tests/product/unit/main/scanCoverage.test.ts`, `tests/product/e2e/scan-safety.e2e.ts`.

**Steps:**

1. Reproduce deletion of a tagged/noted row when its library root is unavailable. Add cases for permission failure in one child, a corrupt existing ZIP, a successful empty directory, a genuinely removed child/ZIP, and cancellation midway through discovery.
2. Return explicit per-scope success/error information from discovery. Do not treat a caught `readdir`, `stat`, ZIP read, or cancellation error as a complete empty namespace. Include enough physical/virtual ancestry to distinguish an unreadable subtree from a confirmed deletion.
3. Implement a pure prune decision helper using canonical containment and C3's coverage proof. Missing root and unreadable scopes preserve their rows; a complete available parent may prove an old child is gone. Confirmed empty available directories may remove stale rows.
4. Restrict deletion candidates to records present at scan start that have not received newer writes. Until D01's repository is integrated, use a compatible scan-start snapshot/revision guard in the existing handler; do not add a second permanent conflict policy.
5. Return terminal status `completed`, `partial`, `failed`, or `cancelled` with affected scopes and retained counts. Keep the existing renderer functioning; U05 later presents the detailed job status. Do not remove annotations or collections as an error-recovery shortcut.

**Acceptance:** The missing-root and unreadable-subtree reproductions retain their original IDs, tags, notes, and collection references. Successful enumeration still removes genuinely deleted files. No deletion happens after cancellation. Errors are distinguishable from an empty library.

**Verify:** Type, focused Unit, Product including isolated scan-safety E2E. Include the unchanged-row evidence in the handoff.

## S02 - Stream discovery and commit useful batches early

**Priority:** P1. **Dependencies:** S01, D01. **Owner:** S.

**Own:** `src/main/scanner.ts`, `src/main/ipc/scanning.ts`; new `src/main/scanService.ts`, `tests/product/unit/main/scanService.test.ts`, `tests/product/e2e/scan-streaming.e2e.ts`. Request any repository additions from D.

**Steps:**

1. Add a controlled two-subtree fixture: the second subtree cannot complete until the test releases it. Require the first subtree's files to become queryable before that release.
2. Change discovery from an all-files array into the C3 event iterator/callback stream. Keep the coverage tracker from S01; do not let streaming weaken pruning proof. ZIP members stream as discovered entries, with a separate archive completion/error marker.
3. Bound discovered-but-uncommitted work to two configured batches. Apply backpressure when full. Commit cheap file identity/stat records before expensive metadata enrichment, preserving existing metadata on unchanged records and marking changed/new enrichment as pending.
4. Use D's batch repository, avoiding duplicate per-file SELECTs and repeated statement preparation. Commit at the configured batch size or a short elapsed-time limit (initially 50 ms), yielding between commits. No transaction spans an awaited I/O operation.
5. Emit immediate first-batch and terminal events, otherwise <=4 Hz. Separate discovered and indexed counters and represent unknown discovery totals honestly. Update metadata later only if its captured content revision still matches.
6. Add an overlapping-root scan registry: coalesce same-root requests and serialize parent/child overlap. Preserve newer watcher writes during final pruning. Export committed-path events for later pending-annotation restore.

**Acceptance:** First results are queryable before discovery finishes; memory queue depth is bounded. Cancellation/errors retain S01 protections. Bulk writes preserve user metadata, and rapid rescan requests do not run competing prune passes.

**Verify:** Type, Unit, Product. Measure first-batch latency and main heartbeat with the 5k fixture. UI progressive display is wired by U05, but the file event and IPC query must be demonstrable here.

## S03 - Move metadata CPU work out of the main process

**Priority:** P1 responsiveness. **Dependencies:** S02. **Owner:** S.

**Execution refinement (2026-09-27):** Implementation may begin against the reviewed S02 service contract after its focused native streaming gate. S02's remaining archive cleanup is confined to scanner/coverage files, while S03 owns metadata/client code and the service's extraction seam. Keep separate checkouts and preserve S02's final correction on integration. S03 runtime acceptance and DONE still require verified S02 and the combined Product gate.

**Own:** `src/main/metadata.ts`, new `src/main/metadataWorker.ts`, `src/main/metadataWorkerClient.ts`, `src/main/scanService.ts`; `tests/product/unit/main/metadata.test.ts`, new worker-client tests. Coordinator adds the utility-worker build entry/lifecycle wiring.

**Steps:**

1. Add a large STL/OBJ extraction test that measures the main heartbeat while metadata is computed. Add worker exit, invalid input, cancellation, and stale-revision completion cases.
2. Start one dedicated metadata utility process lazily, with at most two queued batches and one active extraction. Keep SQLite and user annotations in main. Send paths/request IDs/revisions, returning only small metadata summaries; do not clone large model buffers through main unnecessarily.
3. Make OBJ extraction a streaming counter/bounds accumulator instead of accumulating, joining, and splitting every line. Stream binary STL bounds in record-aligned chunks; support ASCII detection and malformed/truncated input explicitly. For archive entries, stream the selected entry where possible and bound buffered formats to one active file.
4. Make the client own startup, readiness, request timeouts, crash restart, and shutdown. On cancellation terminate/recreate the owned worker if a synchronous parser cannot cooperate. Bound automatic retry to one for a worker crash; parse-invalid files become reported failures.
5. Commit results through D's expected-content-revision update. Discard late results from cancelled jobs/old file revisions. Add extraction metrics to the job, without emitting a UI update for every vertex/file.

**Acceptance:** Main no longer performs full-file triangle/line loops. A huge or corrupt model does not freeze browsing or corrupt another request. Worker crash/cancel settles every pending caller and leaves no duplicate listeners/processes.

**Verify:** Type, Unit, Build, Product. Record main heartbeat, queue bounds, memory observations, and startup/quit behavior. No external sqlite3 CLI.

## S04 - Correct dimensions, units, and measurement provenance

**Priority:** P2 correctness. **Dependencies:** S03. **Owner:** S; coordinate parser ownership with V before editing.

**Own:** `src/main/metadata.ts`; new `src/shared/model/fast3mfGeometry.ts`, `src/shared/model/measurement.ts`; existing fast-parser tests and new measurement tests. This task performs the agreed mechanical move of `src/renderer/lib/fast3mfPreviewParser.ts` to a DOM-free shared core, leaving a compatibility re-export. Any geometry-preparation imports moved with it must be pure and jointly reviewed; other parser/viewer files remain V-owned.

**Steps:**

1. Add fixtures for the audit's 2x build transform, nested components, translated repeated instances, unused resource objects, different declared units, omitted unit, flat meshes, and unsupported external references. Encode expected source-build bounds before any display rotation/normalization.
2. Reuse the existing conservative geometry parser through the shared core rather than writing a second permissive XML regex parser. Preserve its eligibility checks. Add unit metadata/scaling in one shared location, with explicit supported-unit mapping and tests; reject unknown units as unavailable.
3. In the metadata worker, derive 3MF source-build bounds from instantiated transformed geometry for supported cases. Dispose temporary resources. Unsupported/corrupt cases return a reasoned unavailable result; they must not return raw resource bounds as verified dimensions. Keep richer preview fallback support intact.
4. Persist C6's versioned dimensions payload. Re-enrich legacy measurements even when file mtime is unchanged; avoid thumbnail invalidation for measurement-only repair. STL/OBJ report model units. Preserve zero thickness, and reject nonfinite values.
5. Supply V04 with the shared units/source-bound contract for fast and fallback preview preparation. Supply U06 with a pure formatter/presentation shape; do not edit PreviewPanel/ComparePanel/CSS here.

**Acceptance:** The 2x fixture reports the correct doubled dimension, repeated components affect bounds, and unused objects do not. Converted values are scaled once. Unsupported values are visibly distinguishable from trusted dimensions when U06 lands. Existing preview/thumbnail parser parity tests still pass.

**Verify:** Type, Unit across main/shared/renderer geometry tests, Build, Product parser/preview regressions. Record dimensions before display transforms. Check official 3MF unit/transform semantics while implementing if existing tests/source leave any ambiguity; do not guess.

## S05 - Index watcher changes before thumbnail work and preserve ordering

**Priority:** P1. **Dependencies:** D01, S03, T01. **Owner:** S.

**Own:** `src/main/watcher.ts`, `src/main/worker.ts`, `src/main/watcherLifecycle.ts`; new `tests/product/unit/main/watcherUpdates.test.ts`, `tests/product/e2e/watcher-races.e2e.ts`. Read T's scheduler and D's repository without editing them.

**Steps:**

1. Add the failing add-file reproduction: with the watcher running, copy in a supported file and require a usable generated thumbnail while protocol access to unrelated files remains denied.
2. Commit discovery/identity first, then schedule metadata/thumbnail enrichment using that committed content revision. File allowlisting must succeed before the hidden renderer reads it. Do not await thumbnail generation before the row exists or before the UI can see the file.
3. Serialize/coalesce same-path change events. Reject stale enrichment and late thumbnail writes after unlink/change. On equal mtime but explicit change/size difference, advance content revision. Reuse the central lifecycle; do not fork a worker per event.
4. Test add/change/unlink bursts while a scan is active. D's conflict policy protects newer watcher updates from scan completion and stale prune candidates. Batch renderer notifications instead of one refresh per watcher callback.
5. For root-disappearance bursts, preserve records until root availability and complete enumeration provide safe deletion evidence. Keep ordinary confirmed single-file deletion working. Archive changes trigger a contained archive rescan through S's scan service, retaining members on ZIP read failure.

**Acceptance:** New watched files get thumbnails without weakening allowlisting. Rapid replacement/unlink never publishes an old image or re-inserts a removed row. Disconnecting a watched root preserves annotations. Stop/start/reconfigure leaves one worker/listener set.

**Verify:** Type, Unit, Product with the real watcher utility process and isolated filesystem. Include scan+watch churn and reconnect cases.

## S06 - Add explicit scan job pause, cancellation, and targeted retry

**Priority:** P2 product/UX. **Dependencies:** S02, S03, S05. **Owner:** S.

**Own:** `src/main/scanService.ts`, `src/main/ipc/scanning.ts`, new `src/main/scanJobs.ts`; new unit/state-machine tests and `tests/product/e2e/scan-controls.e2e.ts`. Coordinator handles shared job IPC routing; T owns thumbnail controls.

**Steps:**

1. Add transition tests for queued/running/pausing/paused/cancelling/cancelled/completed/partial/failed. Reject invalid resume/retry actions with typed responses, not inconsistent flags.
2. Implement C3 snapshots and commands. Pause acknowledges only after the current bounded unit settles; no new discovery/extraction starts afterward. Resume continues the same scan's coverage state. Cancel aborts discovery, owned metadata requests, queued batches, and subsequent pruning.
3. Keep already committed rows available on pause/cancel. Report partial/offline scopes and failed metadata separately. Track failed scope/file identities so Retry failures does not rescan the entire healthy library.
4. Make terminal publication idempotent. Remove timers that can emit completion for a superseded job. Clean job listeners/request registries at completion while retaining a bounded recent history (last 20 jobs) for the UI.
5. Expose the service via the shared job adapter. A scan does not own watcher enablement; remove any main-side assumption that scan success means watching is desired. Give U05 the exact watch-control integration points.

**Acceptance:** Pause/resume/cancel/retry work while browsing continues. Cancelled/partial work never displays as full success and never triggers stale deletion. Retrying one failure leaves successful roots/files alone. Repeated commands are safe and settle promptly.

**Verify:** Type, Unit, Product. Use barriers/events to demonstrate no new work after pause acknowledgment and no pruning after cancel; do not assert this with a fixed sleep alone.
