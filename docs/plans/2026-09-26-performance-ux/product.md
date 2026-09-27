# Slicer and metadata recovery tasks

Read [contracts C8-C9](contracts.md) and the [tracker](tracker.md). P builds services and typed results; U06 owns UI. The coordinator alone edits existing main registration, preload root, shared settings, and native context-menu wiring. D owns schema changes and repository hooks.

## P01 - Add explicit local slicer handoff, including ZIP members

**Priority:** P2 product. **Dependencies:** F01, F02. **Owner:** P.

**Own:** new `src/main/slicerHandoff.ts`, `src/main/ipc/slicer.ts`, and `tests/product/unit/main/slicerHandoff.test.ts`. Coordinator adds normalized optional app preference, native picker/IPC registration, and later context-menu actions.

**Steps:**

1. Implement a dependency-injected platform launcher and native application picker. No application is selected by guessing. Test argument boundaries for spaces, quotes, leading dashes, and Unicode paths. Windows accepts an executable, not a shell script/command template; Linux validates executable access; macOS supports the selected application bundle.
2. Validate every requested source against current indexed identity and supported format before access/launch. For ordinary files, pass the path as a separate argument or use the explicit default-app fallback and surface platform launch errors.
3. For virtual entries, resolve the exact stored archive/member, reject traversal/absolute/symlink/unsupported entries, and stream only that member into a unique app-owned handoff directory. Use a generated filename preserving the format extension, exclusive creation, the C8 size bound, and cancellation. Never trust an entry path as an extraction destination.
4. Track preparation state and launch only after the file is complete. Clean failed/cancelled partial output immediately. Retain successful files for later startup age-based cleanup, only within the owned directory. Do not remove source files or modify the archive.
5. Return typed results (preparing, opened, cancelled, failure with reason/action) for U06. Configuration remains renderer-owned normalized settings, passed and validated at the boundary; no arbitrary command strings enter main.

**Acceptance:** Explicit regular and archive-member handoff works through the mocked launcher. No real slicer starts during tests. Missing source/app, corrupt ZIP, huge entry, traversal, and cancelled extraction produce clear errors with no leaked partial file. Source bytes stay unchanged.

**Verify:** Type, Unit with real temporary filesystem/ZIP fixtures and mocked launch, Build for registration, and platform-specific launch adapter smoke tests without opening user files. U06 supplies the end-to-end UI flow.

## P02 - Export complete, versioned metadata backups

**Priority:** P2 data recovery. **Dependencies:** F01, F02. **Owner:** P.

**Own:** new `src/shared/metadataBackup.ts`, `src/main/metadataBackupService.ts`, `src/main/ipc/metadataBackup.ts`, and backup-format/export unit tests. Coordinator exposes the actual implemented API; U06 supplies the normalized localStorage snapshot.

**Steps:**

1. Define and validate version-1 backup serialization per C9. Include current annotations and a separate `pendingAnnotations` array, each unique by canonical path, plus normalized collections, roots, and portable preferences. Preserve overlapping current/pending values without export-time merging. Export print status already stored in SQLite even though its editing UI is not part of this plan.
2. Capture a consistent database annotation snapshot with a renderer state revision. If the renderer changes collections/settings while preparing export, retry or ask it for the matching snapshot; do not silently combine different acknowledged revisions.
3. Use a native save dialog and atomic temp-write/rename. Cancellation produces no output; a failed write preserves any previous file and returns a visible error. Handle Unicode paths/notes and large collections without buffering multiple copies needlessly.
4. Exclude cache paths, model content, native application paths, SQLite row IDs, and transient runtime state. Add an explicit manifest statement that source files are external and required for full recovery.
5. Return exported counts/location for U06. Keep serialization/validation pure so P03 can reuse it, and provide a fixture for version/normalization tests.

**Acceptance:** An export contains every tag/note/status and collection membership across more than one browse page. It is independent of UI pagination, can be parsed deterministically, and does not contain model bytes or derived cache state. Cancellation/write failure is non-destructive.

**Verify:** Type, Unit with in-process SQLite and disk writes to temporary locations; targeted IPC smoke test. U06/G01 verify the complete round trip.

## P03 - Preview imports and compute deterministic merge/conflict results

**Priority:** P2 data recovery. **Dependencies:** P02, D01. **Owner:** P.

**Own:** `src/shared/metadataBackup.ts`; new `src/shared/metadataImportPlan.ts`, import-plan tests. Main backup service may validate files and hold plan tokens; do not mutate library state in this task.

**Steps:**

1. Reject oversized, malformed, unsupported-version, and invalid-path inputs before any mutation. Test C9 combined limits across both annotation arrays, duplicates within either array, valid overlap across current/pending arrays, invalid tags/collections/settings, and future versions. Default an absent pendingAnnotations array to empty for compatibility.
2. Compute a pure plan from backup plus current normalized annotations/renderer state. Match canonical paths exactly, including virtual entries; never guess a new library root or map files by name alone. Separate matched, unmatched/pending, changed, unchanged, and conflicting records.
3. Implement fixed merge rules: union tags/membership; fill empty notes; apply imported print status when current status is absent/default `Not Printed`; retain a different existing nondefault status or nonempty note as a reported conflict. Do not create duplicate tags/collections on retry.
4. For collection ID/name collisions, allocate a new stable ID once in the import plan and retain it for retries of that import. Validate collection member paths without requiring that all models are currently online.
5. Settings/root replacement stay unchecked by default. Produce exact before/after normalized local state for each option. Exclude executable preferences and do not trigger scan/watch as a side effect.
6. Attach an opaque plan ID, input fingerprint, database browse/annotation revision, and renderer state revision. Apply must reject an outdated plan and regenerate its preview rather than overwrite changes made after the preview.

**Acceptance:** The same input/current state produces the same changes/conflicts and stable retry IDs. Preview performs zero writes. Existing annotations win the documented conflicts. Unmatched metadata remains represented, not dropped, and unknown versions do not partially import.

**Verify:** Type and pure Unit covering every merge branch, mixed current/backup records, exact virtual paths, and idempotent preview/retry.

## P04 - Apply restores with crash recovery across both stores

**Priority:** P2 data recovery. **Dependencies:** P03, S02. **Owner:** P, with D/coordinator wiring.

**Own:** new `src/main/metadataRestoreService.ts`, `src/main/metadataRestoreJournal.ts`, main backup IPC module, restore/recovery tests, and `tests/product/e2e/restore-recovery.e2e.ts`. D appends migration 6 for pending annotations and import transaction metadata, adds the committed-path callback; coordinator wires startup reconciliation.

**Steps:**

1. Define an idempotent transaction state machine: prepared -> database-applied -> renderer-applied/acknowledged -> complete. Persist the before/after journal and a pre-import recovery backup before changing live values. Follow C9's fixed recovery rule; do not invent a different rollback policy.
2. Validate the plan revisions immediately before commit. Coordinate a short mutation barrier for annotation/collection/settings edits and file-index commits; queue and replay background mutations afterward rather than racing restore. Do not hold a SQLite transaction across a renderer await.
3. Apply annotation changes, pending annotations, and the database-applied transaction marker in one SQLite transaction; preserve unrelated records. Emit the staged renderer state for U06 to apply and acknowledge. Mark complete only after both stores match the transaction. Retry messages for a completed transaction return the same result without duplicate collections or annotations.
4. On startup, reconcile any interrupted journal before automatic scan/watch. Test every boundary: journal written, DB transaction committed before file-journal update, some localStorage keys written, all keys written but ack missing, and ack persisted. With no DB marker, abort the prepared import; with a marker, roll forward to the recorded after-state and acknowledge. Corrupt/unwritable recovery state stays visibly unresolved with mutation gating and the recovery backup retained. Never discard the journal and claim success.
5. Persist unmatched annotations by canonical path. Subscribe to S/D's committed new-path events and apply the same merge policy when those files become indexed; keep unresolved conflicts reported. Mark consumed pending records transactionally and avoid recursively reprocessing annotation-only events.
6. Expose status/recovery backup location, unresolved conflicts, and Retry matching. Provide U06 with the exact localStorage prepare/apply/ack API and startup gating steps. Cancel before commit is a no-op; after commit use the recoverable transaction flow, not a half-applied cancellation.

**Acceptance:** An injected crash at any persistence boundary recovers without losing pre-existing or imported annotations/collections. Unmatched metadata survives restart and applies on later indexing. Repeated apply/ack does not duplicate work. Import does not automatically open an app, start a scan, or override watch enablement.

**Verify:** Type, Unit with real SQLite transactions and staged failure injection, Build, Product with isolated renderer localStorage and forced restart. Include a >500-record round trip and a restore racing a queued watcher update.
