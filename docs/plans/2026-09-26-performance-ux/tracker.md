# Performance and UX task tracker

[Execution plan](../2026-09-26-performance-ux-execution-plan.md) | [Shared contracts](contracts.md) | [Handoff template](handoff-template.md)

**Execution active:** The user resumed work under the [sequential policy](../2026-09-27-sequential-execution-policy.md). Stage 4 recovery candidate `0c5496d` and S04 candidate `914d645` passed serial reviews, build, and full Product verification. S05 is blocked after automatic review rejected its core watcher integration; no watcher.ts change was applied. U04 is underway as the next independent dependency-ready task under the policy's blocker exception.

**Coordination handoff:** [Luna execution plan](../2026-09-27-luna-coordinator-handoff.md). The sequential policy is authoritative: implementation, independent reviews, integration, and verification run serially. Astra is reserved for final integration review. No push to `origin/main`, release, or publication is authorized.

**Stage 1 gate (2026-09-27):** S02/V03 are verified on integrated source `bf6cdfe` (the then-current HEAD `e4c0829` was docs-only) plus the coalesced-mutation E2E correction. `npm run build` passed. Full `PYTHON=/usr/bin/python3 npm run test:product` passed: 257 unit passes, 1 Windows-only skip; 40 E2E passes, 1 optional real-model skip. The scanner hold needed scoped filesystem watcher access; the default sandbox run's only failure was its recorded EMFILE watcher limit. E2E confirmed 5.1 ms first query, 35.21 ms maximum main heartbeat gap, and 73 ms obsolete preview-renderer stop. The E2E allows coalesced `rowsChanged` flags while direct annotation-only flags remain asserted in the repository unit test.

**Execution scope:** F01, F02, D01-D03, S01-S04, T01-T04, V01-V03, P01-P03, U01-U03, and V02 are reviewed and integrated. Stages 1-4 and S04 are complete. S05 remains blocked by the watcher integration review; U04 is active as an independent task under the sequential-policy exception. P04 remains one serial persistence stream, sequenced after V04/S04. P02's renderer revision binding, pending-annotation provider, and user-facing export action remain explicitly owned by P04/U06. No unrelated user edits are included in candidate commits.

**Stage 2 gate (2026-09-27):** Integrated S03/T02 candidate passed `npm run build` and full `PYTHON=/usr/bin/python3 npm run test:product`: 296 unit passes, 1 Windows-only skip; 42 E2E passes, 1 optional real-model skip. The metadata-worker E2E passed a large OBJ scan with a <=250 ms main heartbeat and clean app shutdown. The thumbnail invalidation E2E passed color refresh, folder isolation, clear/regeneration, missing-reference reconciliation, and cache-version reset. S02 recorded 5.6 ms to first query and 35.17 ms maximum main heartbeat gap; V03 stopped the obsolete renderer in 72 ms. The generated `test_bundle.zip` was restored to baseline SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`.

**Stage 3 gate (2026-09-27):** Integrated U01/V02 candidate passed `npm run build` and full `PYTHON=/usr/bin/python3 npm run test:product`: 325 unit passes, 1 Windows-only skip; 44 E2E passes, 1 optional real-model skip. The 600-record mixed archive/collection flow, thumbnail arrival/invalidation, preview identity/camera preservation, failed-parse retry, and forward/backward archive paging passed. A deliberate bad archive member remained recoverable without blocking navigation. The generated `test_bundle.zip` was restored to its baseline SHA256.

**Stage 4 gate (2026-09-27):** Recovery candidate `0c5496d` passed independent spec and quality review, `npm run build`, and full `PYTHON=/usr/bin/python3 npm run test:product`: 337 unit passes, 1 Windows-only skip; 47 E2E passes, 1 optional real-model skip. The previously failing library-pages E2E was diagnosed: its one-shot `scrollTo(max)` did not drive Virtuoso's incremental scroll updates. Repeated real mouse-wheel input loaded the valid second page without changing paging behavior or weakening assertions. U02 request-count/search flows, S03 utility-process heartbeat, and T04 thumbnail controls passed. `test_bundle.zip` was restored to SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`.

**Progress:** 22 / 33 DONE. Foundation 2/2; data 3/3; scanning 4/6; thumbnails 4/4; preview 3/5; browsing 3/6; product workflows 3/4; validation 0/3. Last accepted product source: `914d645`.

## Status and update rules

- `PLANNED`: specified, not started. `READY`: authorized and all listed dependencies are DONE. `IN_PROGRESS`: one named owner is implementing. `REVIEW`: implementation exists; verification/review/integration remains. `BLOCKED`: a concrete external dependency or required decision prevents progress. `DONE`: task acceptance, in-scope wiring, review, and evidence are complete.
- Only the coordinator edits this tracker. Workers report through task-specific handoffs. A task may provide a completed service/component before a separately tracked consumer task integrates it; its own contract tests and required adapter wiring must still pass. Do not claim the later user journey is complete early.
- On dispatch, set owner, checkout/branch if used, and start status; add the handoff link in Evidence. On completion record commands/results and review in that handoff, then set DONE. Review dependencies before selecting the next READY task.
- Every implementation task requires the owning scope and contracts from its spec. A failing cross-stream integration returns to the responsible owner; record new blockers and contract changes here. Do not silently widen a worker's file ownership.
- After authorization, **F01 and F02 are initially eligible**. Recompute readiness from dependencies, not row order. Tasks in the same file-owning stream remain serial even if both are dependency-ready.

## Task register

| ID | Task specification | Priority | Dependencies | Status | Owner | Evidence / handoff |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | [Contracts and preview seam](foundation-data.md#f01---freeze-contracts-and-extract-the-preview-seam) | Foundation | - | DONE | f01_foundation (Luna/medium) | [F01](handoffs/F01.md); integrated `9430eb9`, `da1adf8` |
| F02 | [Fixtures and diagnostics](foundation-data.md#f02---establish-portable-fixtures-and-trustworthy-diagnostics) | Foundation | - | DONE | f02_fixtures (Luna/medium) | [F02](handoffs/F02.md); spec/quality and combined gate passed |
| D01 | [Indexed scopes and batched writes](foundation-data.md#d01---indexed-folder-membership-and-a-batched-write-repository) | P1 | F01, F02 | DONE | d01_index_repository (Luna/medium) | [D01](handoffs/D01.md); core through `fa38a6d`, guarded missing-row follow-up `8265dd2`/`37eb013`; reviews/checks passed |
| D02 | [Complete SQL display pages](foundation-data.md#d02---query-complete-display-pages-in-sqlite) | P1 | D01 | DONE | d01_index_repository (Luna/medium) | [D02](handoffs/D02.md); independent spec/quality PASS, units/Build/IPC/benchmark PASS; integrated `288724e` through `516e79c` |
| D03 | [Independent library summaries](foundation-data.md#d03---separate-library-summaries-from-list-queries) | P2 | D02 | DONE | d01_index_repository (Luna/medium) | [D03](handoffs/D03.md); independent spec and coordinator quality PASS; 164 units, Type/Build PASS; integrated `3bc4a2c`, `824be77`, `2f152af` |
| S01 | [Safe enumeration and pruning](scanning.md#s01---require-proof-of-successful-enumeration-before-pruning) | P1 | F01, F02 | DONE | s01_safe_scanning (Luna/medium) | [S01](handoffs/S01.md); both reviews and runtime gate passed |
| S02 | [Streaming discovery and early batches](scanning.md#s02---stream-discovery-and-commit-useful-batches-early) | P1 | S01, D01 | DONE | baseline_validation reassigned (Luna/medium) | [S02](handoffs/S02.md); combined Type/Build/Product PASS on `bf6cdfe` source; 5.1 ms first query, 35.21 ms heartbeat maximum |
| S03 | [Background metadata extraction](scanning.md#s03---move-metadata-cpu-work-out-of-the-main-process) | P1 | S02 | DONE | Luna/medium chat `01a0e293-6dd9-74d0-b51b-a11a33697713` | [S03](handoffs/S03.md); utility-process source/tests and coordinator wiring integrated; Product + metadata-worker heartbeat E2E PASS |
| S04 | [Dimensions and units](scanning.md#s04---correct-dimensions-units-and-measurement-provenance) | P2 | S03 | DONE | sequential recovery candidate | [S04](handoffs/S04.md); spec/quality PASS; Build and Product PASS on `914d645`, 356 unit passes/1 skip and 47 E2E passes/1 optional skip |
| S05 | [Watcher ordering and thumbnail availability](scanning.md#s05---index-watcher-changes-before-thumbnail-work-and-preserve-ordering) | P1 | D01, S03, T01 | BLOCKED | sequential candidate | Automatic review rejected the attempted watcher.ts core event-handler/lifecycle integration; partial lifecycle/test work is preserved in `/Users/maak/.codex/worktrees/s05-watcher-order/polytray` |
| S06 | [Scan controls and targeted retry](scanning.md#s06---add-explicit-scan-job-pause-cancellation-and-targeted-retry) | P2 | S02, S03, S05 | PLANNED | Unassigned | - |
| T01 | [Thumbnail identity and settlement](thumbnails.md#t01---make-thumbnail-requests-and-cache-identities-settle-correctly) | P1 | D01 | DONE | Luna/medium chat `01a0e201-7438-7391-9843-ac3d21ed3c67` | [T01](handoffs/T01.md); both reviews, actual hidden renderer and full Product PASS; merged `9479c7f` |
| T02 | [Authoritative refresh and cache reset](thumbnails.md#t02---make-refresh-clear-and-cache-version-reset-authoritative) | P1 | T01 | DONE | Luna/medium chat `01a0e201-7438-7391-9843-ac3d21ed3c67` | [T02](handoffs/T02.md); invalidation service, bounded event API and coordinator IPC adapters integrated; Product + thumbnail invalidation E2E PASS; U01 owns consumer |
| T03 | [Shared path-only thumbnail presentation](thumbnails.md#t03---keep-file-state-path-only-and-share-thumbnail-reads) | P1 | F01, F02 | DONE | baseline_validation (Luna/medium) | [T03](handoffs/T03.md); spec/independent quality PASS, 12 focused tests/Type/Build/lint PASS; producer integrated `d1c44b7`, `1fd9c44`; consumers U01/T02 |
| T04 | [Thumbnail queue controls and accounting](thumbnails.md#t04---centralize-thumbnail-queue-state-controls-and-retry-accounting) | P2 | T02 | DONE | sequential recovery candidate | [T04](handoffs/T04.md); spec/quality PASS; Product PASS on `0c5496d`; bounded retry and thumbnail-only controls |
| V01 | [Viewer lifetime and idle rendering](preview.md#v01---give-each-viewer-a-lifecycle-and-stop-drawing-when-idle) | P2 | F01, F02 | DONE | f01_foundation + s01_safe_scanning (Luna/medium) | [V01](handoffs/V01.md); reviewed and integrated through `cb63f7a` |
| V02 | [Stable preview state and lazy archive navigation](preview.md#v02---decouple-metadata-from-geometry-and-show-durable-preview-states) | P2 | V01, D02 | DONE | Luna/medium chat `01a0e202-0863-7f30-bfb8-c159d2e58053` | [V02](handoffs/V02.md); integrated U01 target/event seams, error/retry/archive E2E and full Stage 3 Product PASS |
| V03 | [Owned cancellable preview runtime](preview.md#v03---cancel-obsolete-parsing-through-an-owned-preview-runtime) | P2 | F01, F02, D01 | DONE | s01_safe_scanning reassigned (Luna/medium) | [V03](handoffs/V03.md); combined Type/Build/Product PASS; latest cancellation E2E stopped obsolete renderer in 73 ms |
| V04 | [Background preparation and bounded assembly](preview.md#v04---prepare-orientation-in-the-background-and-budget-visible-mesh-assembly) | P2 | V01, V03, S04 | PLANNED | Unassigned | - |
| V05 | [Progressive part thumbnails](preview.md#v05---make-part-thumbnails-small-progressive-and-independent) | P2 | V04 | PLANNED | Unassigned | - |
| U01 | [Complete browsing and consistent selection](browsing.md#u01---load-every-result-and-keep-selection-consistent-across-pages) | P1 | D02, T03 | DONE | Luna/medium chat `01a0e202-8608-7f21-a52d-5e89ef92806b` | [U01](handoffs/U01.md); paging, selection/deletion, thumbnail consumer, and full Stage 3 Product PASS |
| U02 | [Search state and targeted refresh](browsing.md#u02---unify-search-state-and-refresh-only-what-changed) | P2 | U01, D03 | DONE | sequential recovery candidate | [U02](handoffs/U02.md); spec/quality PASS; focused search/pagination E2Es and Product PASS on `0c5496d` |
| U03 | [Responsive panel layout](browsing.md#u03---keep-browsing-usable-at-every-supported-window-size) | P2 | F01, F02 | DONE | Luna/medium chat `01a0e202-8608-7f21-a52d-5e89ef92806b` | [U03](handoffs/U03.md); both reviews and full Product PASS; integrated `890e4ba` through `b84ba09` |
| U04 | [Keyboard navigation and focus](browsing.md#u04---support-keyboard-navigation-and-predictable-focus) | P2 | U01, U03, V02 | REVIEW | u04_keyboard_focus, Luna/medium | [U04](handoffs/U04.md); folder-focus repair `143d3fa`; Build, 10 units, and 3 focused keyboard E2Es pass; serial review recheck and final Product pending |
| U05 | [Background work UI and watch preferences](browsing.md#u05---present-useful-progress-and-respect-watcher-preferences) | P2 | U02, S06, T04 | PLANNED | Unassigned | - |
| U06 | [Workflow and measurement UI integration](browsing.md#u06---integrate-slicer-backuprestore-and-honest-measurements) | P2 | U04, P01, P02, P04, S04 | PLANNED | Unassigned | - |
| P01 | [Local slicer and archive handoff](product.md#p01---add-explicit-local-slicer-handoff-including-zip-members) | P2 | F01, F02 | DONE | Luna/medium chat `01a0e204-6183-7ee2-a2ac-0bbd43568fa3` | [P01](handoffs/P01.md); source/reviews and combined startup Product PASS at T01 merge `9479c7f`; U06 owns explicit UI activation |
| P02 | [Versioned metadata export](product.md#p02---export-complete-versioned-metadata-backups) | P2 | F01, F02 | DONE | s01_safe_scanning (Luna/medium) | [P02](handoffs/P02.md); producer reviewed/integrated `e1c66e8`, `6de841f`; consumer binding P04/U06 |
| P03 | [Deterministic import preview](product.md#p03---preview-imports-and-compute-deterministic-mergeconflict-results) | P2 | P02, D01 | DONE | Luna/medium chat `01a0e202-0863-7f30-bfb8-c159d2e58053` | [P03](handoffs/P03.md); independent spec/coordinator quality PASS; combined Type/Build, 182 units/1 skip; integrated `447cebe` through `eb2f00e` plus test fixture integration |
| P04 | [Recoverable restore transaction](product.md#p04---apply-restores-with-crash-recovery-across-both-stores) | P2 | P03, S02 | PLANNED | Unassigned | - |
| G01 | [Integrated correctness and recovery](validation.md#g01---prove-integrated-correctness-and-recovery) | Gate | U05, U06, V05 | PLANNED | Unassigned | - |
| G02 | [Performance and resource evidence](validation.md#g02---verify-performance-and-resource-budgets) | Gate | G01 | PLANNED | Unassigned | - |
| G03 | [Documentation and readiness](validation.md#g03---reconcile-documentation-and-hand-back-execution-results) | Gate | G02 | PLANNED | Unassigned | - |

## Active assignments

| Assignment | Worker | Worktree / branch | State |
| --- | --- | --- | --- |
| D03 | d01_index_repository, Luna/medium | `/Users/maak/.codex/worktrees/polytray-d03/polytray` / `codex/perf-d03` | DONE: integrated; checkout free after handoff |
| V03 | s01_safe_scanning reassigned, Luna/medium | `/Users/maak/.codex/worktrees/polytray-review/polytray` / `codex/perf-v03` | DONE: combined Type/Build/Product PASS; checkout preserved |
| S02 | baseline_validation reassigned, Luna/medium | `/Users/maak/.codex/worktrees/polytray-fixtures/polytray` / `codex/perf-s02` | DONE: combined Product PASS; checkout preserved |
| S03 | Registered Luna/medium chat | `/Users/maak/.codex/worktrees/polytray-foundation/polytray` / `codex/perf-s03` | DONE: integrated `9e9cdd6`, `402aa9c`, `e6a1e75`, `6f3c389`, coordinator wiring `ca263f8`; runtime E2E passed |
| T03 old dispatch | Superseded draft, no usable chat ID | `/Users/maak/.codex/worktrees/61df/polytray`, `74d2e9e` | Preserved unreviewed alternative; active T03 producer already integrated |
| T02 | Registered Luna/medium chat, T01 complete | `/Users/maak/.codex/worktrees/polytray-thumbnails/polytray` / `codex/perf-t02` | DONE: service `e117e86`, quarantine fixes `739a7d4`/`bc74d3f`/`181fc53`/`5dfbc8f`; event API `f14b7a8`/`f7bc207`/`65d3dea`; coordinator guard `fc856ab` |
| U01 | Luna/medium chat `01a0e202-8608-7f21-a52d-5e89ef92806b` | `/Users/maak/.codex/worktrees/polytray-layout/polytray` / `codex/perf-u01` | DONE: Stage 3 Product verified; checkout preserved |
| V02 | Luna/medium chat `01a0e202-0863-7f30-bfb8-c159d2e58053` | `/Users/maak/.codex/worktrees/polytray-import/polytray` / `codex/perf-v02` | DONE: owned preview commits integrated; unrelated partial merge preserved |
| U02 + T04 recovery | `/root/stage4_recovery`, Luna/medium | `/Users/maak/repos/polytray` / `0c5496d` | DONE: serialized spec/quality PASS and full Product PASS; prior U02/T04 worktrees preserved |
| S04 | `/root/s04_measurements`, Luna/medium | `/Users/maak/.codex/worktrees/s04-measurements/polytray` / `7f53794` | DONE: implementation and narrow harness repair integrated at `914d645`; reviews, Build, and full Product PASS |
| S05 | `/root/s05_watcher_order`, Luna/medium | `/Users/maak/.codex/worktrees/s05-watcher-order/polytray` / based on `3e28f24` | BLOCKED after auto-review rejection of the watcher.ts integration attempt; only watcherLifecycle.ts and watcherUpdates.test.ts are modified and preserved uncommitted |
| U04 | `/root/u04_keyboard_focus`, Luna/medium | `/Users/maak/.codex/worktrees/u04-keyboard-focus/polytray` / `143d3fa` | IMPLEMENTATION COMPLETE: focused review recheck, integration, and required Product gate pending |
| P01 | Registered Luna/medium chat | `/Users/maak/.codex/worktrees/polytray-slicer/polytray` / `codex/perf-p01` | DONE; checkout available for later P04 after status check |
| Independent review | Luna/medium chat `01a0e1fe-a466-7810-9892-71009a512cc2` | Read-only exact candidate checkouts | U01/V02, Stage 4 U02/T04, and S04 spec/quality plus scanner-harness follow-up PASS |
| U03 old dispatch | Superseded draft, no usable chat ID | `/Users/maak/.codex/worktrees/1221/polytray`, `3a3b13c` | Preserved unreviewed alternative; active owner is the registered layout chat |
| P01 old dispatch | Superseded draft, no usable chat ID | `/Users/maak/.codex/worktrees/861a/polytray`, `b9701b5` | Preserved unreviewed alternative; active owner is the registered slicer chat |

The sequential policy governs active ownership and verification. Current accepted product source: `914d645`; `c6868e7` is the historical execution baseline.
The three original worktree-chat requests never returned usable task IDs. Later repository inspection found completed draft commits in their worktrees, recorded above; they are preserved and superseded rather than silently merged. U01/V02 are complete. The Stage 4 U02/T04 workers use separate managed worktrees and private dependency copies; their owned paths are disjoint. P01 and P03 were explicitly allowed concurrently because their source ownership was disjoint.

The coordinator explicitly delegated D01's startup/library-change bridge and V03's preview IPC/readiness/build-entry wiring in their separate checkouts. Each wiring delta is committed separately and receives coordinator review; common-file conflicts are resolved once at integration. V03 may mechanically remove the old preview hookup from thumbnail-owned files, while preserving thumbnail behavior.

D02 may implement its exact query IPC/readiness/validator bridge as a separate common-wiring commit. S02 may adapt nullable scan totals and the existing App progress callback, plus iterable pruning inputs and metadata counters. T01 may extend the existing normalized `thumbQuality` runtime field and typed attempt/ready payloads, with only minimal App/PreviewPanel quality prop threading. U03 retains layout ownership; V03 retains revision/cancellation threading. The coordinator reconciles these narrow, isolated common-file changes and verifies the combined result.

V03 also needs the persisted D01 content revision at its existing preview caller. This runtime prerequisite was exposed during source tracing and is now explicit; no timestamp/size substitute is permitted. Its narrow caller adaptation is authorized, while V02 retains geometry-identity and state refactoring. T03 has moved to the active subagent pool because the extra-chat request has not registered; no second active implementation is known.

S02 preparation exposed one additional D01 guard: a positive expected content revision must not insert a now-missing row. This is fixed and integrated as `8265dd2`/`37eb013`; independent spec and coordinator quality reviews passed, with 21 focused SQLite tests plus Type/Build. The observed-absent case deliberately uses equal timestamp/size and also proves legitimate absent inserts work. S02 still owns the in-flight path-mutation fence, including observed-absent add/remove races; no unguarded substitute is allowed.

## Integration log

| Date | Task / checkpoint | Result | Follow-up |
| --- | --- | --- | --- |
| 2026-09-26 | Planning | Execution plan and tracker prepared | Complete |
| 2026-09-26 | Execution authorization | Concurrent Luna/medium worktrees, commits, and local-main integration approved | F01/F02 dispatched; independent baseline validation passed; no origin/main push |
| 2026-09-26 | F01 candidate | Typecheck/build, 59 units and 29 E2E pass; optional real model skipped | Two C9 declarations fixed; spec and quality reviews passed at `6909757` |
| 2026-09-26 | Baseline gate | Build PASS; 57 unit tests and 29 E2E tests PASS; 1 optional real-model test skipped | [Report](handoffs/baseline-validation.md); use `PYTHON=/usr/bin/python3` for native rebuilds |
| 2026-09-26 | Combined foundation gate | Build PASS; 66 unit tests and 29 E2E tests PASS; 1 optional real-model test skipped | F01/F02 review gates complete; parallel workstreams eligible |
| 2026-09-26 | S01 safety gate | Both reviews PASS; Build, 84 units and 30 E2E PASS; 1 optional skip; lookup-only follow-up passed focused18/type/build | Integrated scan coverage, cancellation, annotation/ABA guards and linear snapshot lookup |
| 2026-09-27 | V01 gate | Spec and quality PASS; Build + 88 units + 33 E2E PASS, 1 optional skip; color-init correction observed RED then GREEN in focused E2E/type/build | Integrated `6b0f643` through `cb63f7a`; macOS native minimize/restore verified; other platforms pending |
| 2026-09-27 | P02 producer gate | Independent spec and quality PASS; 14 focused and 98 product units, Type/Build PASS | Integrated export-only service and registration adapter; live revision/provider/UI consumer wiring remains P04/U06 |
| 2026-09-27 | T03 producer gate | Coordinator spec and independent quality PASS; 12 focused renderer tests, Type/Build/lint PASS | Integrated bounded shared image loader; U01/T02 must wire path-only updates and invalidate same-path ready events |
| 2026-09-27 | D01 gate | Core/adapters/IPC reviews PASS; 133 unit passes/1 native-Windows skip; all 35 non-optional E2E cases pass across Product plus corrected app-file rerun; portability follow-up focused tests/Type/Build PASS | Integrated migration5, guarded repository, bounded backfill and typed notifications; Windows/Linux app runs remain outstanding |
| 2026-09-27 | D02 gate | Independent spec/quality PASS; 157 unit passes/1 Windows-only skip, Type/Build PASS, actual IPC smoke 1/1 | 10k/50k grouped folder median 14.77/79.71 ms; 50k p95 81.35 ms; heartbeat max 143.96 ms; final G02 repeats on integrated app |

| 2026-09-27 | D03 gate | Independent spec and coordinator quality PASS; 164 unit passes/1 Windows-only skip, Type/Build PASS; production summary IPC handlers exercised with real SQLite | Integrated revision-keyed summaries and precise mutation flags; renderer query reduction remains U02 |

| 2026-09-27 | U03 gate | Independent spec/quality PASS; 154 units/1 skip, 36 E2E/1 optional skip, 18 responsive captures; combined main Type/Build and 9 focused tests PASS | Integrated; layout checkout reassigned U01; U04 owns keyboard/modal focus |

| 2026-09-27 | P03 gate | Independent spec and coordinator quality PASS; combined Type/Build and 182 units/1 Windows-only skip PASS | Import preview integrated; test-only panel-settings expectation updated after observed combined failure and independent review. Apply/recovery remains P04/U06 |

V02 can now proceed independently in the completed import checkout: V03's source is committed and statically reviewed, with remaining runtime work confined to its separate checkout. V02 starts from that reviewed candidate and may not be marked complete until the V03 native gate and joint U01 target wiring pass. The coordinator authorized a separate `src/shared/previewTarget.ts` type seam so U01 owns target creation and V02 owns lazy archive navigation.

| 2026-09-27 | Test-launch repair | Exact native stack proved macOS crash-restore dialog blocked Electron ready; per-launch ignore-state flag removes it without global preference/state changes. Independent spec/quality and portable helper tests 3/3 PASS | Integrated `55b1bed`; all new app tests must use shared launch arguments. S02 database-startup stop still needs separate diagnosis |
| 2026-09-27 | P01 source integration | Independent spec/quality corrections complete; combined Type/Build and 209 unit passes/1 Windows-only skip PASS | Kept REVIEW pending combined Product startup gate; U06 activation remains downstream |

| 2026-09-27 | T01/P01 combined gate | 219 unit passes/1 Windows skip, 38 E2E passes/1 optional model skip; actual hidden-renderer lifecycle and startup passed. Both source reviews PASS | Merged `9479c7f`; source/test/config tree matches tested `a809295` exactly, combined main Type/Build PASS. T01 and P01 DONE; S02 takes native lane |

| 2026-09-27 | S02/V03 native checkpoints | S02 held-subtree query in 5.9ms, main heartbeat35.16ms; V03 old parser stopped73ms with distinct PIDs, C-only success/fallback and independent thumbnails | Both full Product runs stopped in Node units on the same lazy empty-ZIP stream cleanup; corrected S02 candidate `f07baf7` is under independent review. A separate scanner-hold EMFILE was sandbox FSEvents denial: identical escalated test passed, no watcher code changed |

| 2026-09-27 | S02/V03 combined gate | `npm run build` PASS; Product PASS: 257 unit passes/1 Windows-only skip, 40 E2E passes/1 optional model skip; exact test candidate reviewed | E2E flags distinguish direct annotation-only repository mutations from intentionally coalesced renderer notifications; S02 and V03 DONE, resume T02/S03 |

| 2026-09-27 | S03/T02 combined gate | `npm run build` PASS; `PYTHON=/usr/bin/python3 npm run test:product` PASS: 296 unit passes/1 Windows-only skip, 42 E2E passes/1 optional model skip | Metadata worker responsiveness E2E and thumbnail invalidation E2E pass; API bounded to 256 path entries per list; T02/S03 DONE; U01/V02 are next |

| 2026-09-28 | S04 gate | Spec/quality PASS; Build PASS; full `PYTHON=/usr/bin/python3 npm run test:product` PASS: 356 unit passes/1 Windows-only skip, 47 E2E passes/1 optional model skip | User-authorized narrow scanner-hold repair replaced both marker watchers with bounded polling and derived subtree order from actual enumeration; retained all assertions and the 5s deadline. Candidate `914d645`; fixture restored to SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`. |

## Blockers and decisions

Execution is active. The default Python native-rebuild issue is resolved by selecting `/usr/bin/python3`; no package change was needed. Both foundation tasks and their review corrections are integrated. P02 is explicitly allowed alongside the pending P01 request because their files are disjoint. The V1 export format now separates current and pending annotation arrays to preserve overlapping values; imports merge only after preview. Approved defaults are in `contracts.md`; any contract revision must be coordinated before consumer dispatch. Graph tooling was unavailable during the audit; future agents must check its availability/freshness and otherwise use source fallback rather than claiming graph coverage. The existing marketing/media changes are unrelated and must remain intact. The user authorized a narrow scanner-hold marker-wait repair, which is complete; S05's core watcher integration remains blocked after automatic review. U04 proceeds as an independent ready task under the sequential policy's blocker exception.

## Completion evidence checklist

- [ ] Every audit finding is mapped to a completed task and passing regression.
- [ ] All producer/consumer wiring and runtime contracts are integrated.
- [ ] Data-loss, stale-result, and restore interruption tests pass.
- [ ] Query, first-result, idle-render, cancellation, and resource measurements are recorded.
- [ ] Build + Product pass on the integrated result; supported-platform coverage is recorded.
- [ ] Documentation describes the implemented behavior and remaining limits accurately.
- [ ] User receives the final evidence and chooses any next publication step.
