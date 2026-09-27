# Performance and UX task tracker

[Execution plan](../2026-09-26-performance-ux-execution-plan.md) | [Shared contracts](contracts.md) | [Handoff template](handoff-template.md)

**Execution authorized:** Luna agents at medium reasoning, isolated worktrees, task commits, and coordinator integration into local main. No push to origin/main without explicit user permission. F01, F02, D01-D03, S01, T03, V01, and the P02/P03 backup services are reviewed and integrated. Six implementation lanes cover S02/T01/V02/V03/U01/P01, with independent reviews. P02's renderer revision binding, pending-annotation provider, and user-facing export action remain explicitly owned by P04/U06; T03 consumers remain U01/T02. The original unregistered chat requests are superseded by the active assignments below.

**Progress:** 13 / 33 DONE. Foundation 2/2; data 3/3; scanning 1/6; thumbnails 2/4; preview 1/5; browsing 1/6; product workflows 3/4; validation 0/3. D02's query service, IPC smoke, benchmark and reviews are complete; UI paging remains U01/V02.

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
| S02 | [Streaming discovery and early batches](scanning.md#s02---stream-discovery-and-commit-useful-batches-early) | P1 | S01, D01 | IN_PROGRESS | baseline_validation reassigned (Luna/medium) | Dispatch from verified local-main base |
| S03 | [Background metadata extraction](scanning.md#s03---move-metadata-cpu-work-out-of-the-main-process) | P1 | S02 | PLANNED | Unassigned | - |
| S04 | [Dimensions and units](scanning.md#s04---correct-dimensions-units-and-measurement-provenance) | P2 | S03 | PLANNED | Unassigned | - |
| S05 | [Watcher ordering and thumbnail availability](scanning.md#s05---index-watcher-changes-before-thumbnail-work-and-preserve-ordering) | P1 | D01, S03, T01 | PLANNED | Unassigned | - |
| S06 | [Scan controls and targeted retry](scanning.md#s06---add-explicit-scan-job-pause-cancellation-and-targeted-retry) | P2 | S02, S03, S05 | PLANNED | Unassigned | - |
| T01 | [Thumbnail identity and settlement](thumbnails.md#t01---make-thumbnail-requests-and-cache-identities-settle-correctly) | P1 | D01 | DONE | Luna/medium chat `01a0e201-7438-7391-9843-ac3d21ed3c67` | [T01](handoffs/T01.md); both reviews, actual hidden renderer and full Product PASS; merged `9479c7f` |
| T02 | [Authoritative refresh and cache reset](thumbnails.md#t02---make-refresh-clear-and-cache-version-reset-authoritative) | P1 | T01 | READY | Luna/medium thumbnail chat | Reuse verified thumbnail checkout after new local branch |
| T03 | [Shared path-only thumbnail presentation](thumbnails.md#t03---keep-file-state-path-only-and-share-thumbnail-reads) | P1 | F01, F02 | DONE | baseline_validation (Luna/medium) | [T03](handoffs/T03.md); spec/independent quality PASS, 12 focused tests/Type/Build/lint PASS; producer integrated `d1c44b7`, `1fd9c44`; consumers U01/T02 |
| T04 | [Thumbnail queue controls and accounting](thumbnails.md#t04---centralize-thumbnail-queue-state-controls-and-retry-accounting) | P2 | T02 | PLANNED | Unassigned | - |
| V01 | [Viewer lifetime and idle rendering](preview.md#v01---give-each-viewer-a-lifecycle-and-stop-drawing-when-idle) | P2 | F01, F02 | DONE | f01_foundation + s01_safe_scanning (Luna/medium) | [V01](handoffs/V01.md); reviewed and integrated through `cb63f7a` |
| V02 | [Stable preview state and lazy archive navigation](preview.md#v02---decouple-metadata-from-geometry-and-show-durable-preview-states) | P2 | V01, D02 | IN_PROGRESS | Luna/medium chat `01a0e202-0863-7f30-bfb8-c159d2e58053` | Reuses completed import checkout `codex/perf-v02`, base reviewed V03 `cba30cb`; joint U01 preview-target seam |
| V03 | [Owned cancellable preview runtime](preview.md#v03---cancel-obsolete-parsing-through-an-owned-preview-runtime) | P2 | F01, F02, D01 | REVIEW | s01_safe_scanning reassigned (Luna/medium) | corrected direct geometry transport and lifecycle reviews PASS; native cancellation gate pending |
| V04 | [Background preparation and bounded assembly](preview.md#v04---prepare-orientation-in-the-background-and-budget-visible-mesh-assembly) | P2 | V01, V03, S04 | PLANNED | Unassigned | - |
| V05 | [Progressive part thumbnails](preview.md#v05---make-part-thumbnails-small-progressive-and-independent) | P2 | V04 | PLANNED | Unassigned | - |
| U01 | [Complete browsing and consistent selection](browsing.md#u01---load-every-result-and-keep-selection-consistent-across-pages) | P1 | D02, T03 | IN_PROGRESS | Luna/medium chat `01a0e202-8608-7f21-a52d-5e89ef92806b` | Reuses completed layout checkout on `codex/perf-u01`, base `b84ba09` |
| U02 | [Search state and targeted refresh](browsing.md#u02---unify-search-state-and-refresh-only-what-changed) | P2 | U01, D03 | PLANNED | Unassigned | - |
| U03 | [Responsive panel layout](browsing.md#u03---keep-browsing-usable-at-every-supported-window-size) | P2 | F01, F02 | DONE | Luna/medium chat `01a0e202-8608-7f21-a52d-5e89ef92806b` | [U03](handoffs/U03.md); both reviews and full Product PASS; integrated `890e4ba` through `b84ba09` |
| U04 | [Keyboard navigation and focus](browsing.md#u04---support-keyboard-navigation-and-predictable-focus) | P2 | U01, U03, V02 | PLANNED | Unassigned | - |
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
| V03 | s01_safe_scanning reassigned, Luna/medium | `/Users/maak/.codex/worktrees/polytray-review/polytray` / `codex/perf-v03` | Implementing |
| S02 | baseline_validation reassigned, Luna/medium | `/Users/maak/.codex/worktrees/polytray-fixtures/polytray` / `codex/perf-s02` | Test harness corrected; streaming native gate pending; lane released to T01 |
| T03 old dispatch | Superseded draft, no usable chat ID | `/Users/maak/.codex/worktrees/61df/polytray`, `74d2e9e` | Preserved unreviewed alternative; active T03 producer already integrated |
| T01 | Registered Luna/medium chat | `/Users/maak/.codex/worktrees/polytray-thumbnails/polytray` / `codex/perf-t01` | Owns native hidden-renderer and combined Product lane |
| U01 | Registered Luna/medium chat, U03 complete | `/Users/maak/.codex/worktrees/polytray-layout/polytray` / `codex/perf-u01` | Implementing complete paging and selection |
| V02 | Registered Luna/medium chat, P03 complete | `/Users/maak/.codex/worktrees/polytray-import/polytray` / `codex/perf-v02` | Implementing stable preview state and lazy archive navigation |
| P01 | Registered Luna/medium chat | `/Users/maak/.codex/worktrees/polytray-slicer/polytray` / `codex/perf-p01` | Implementing |
| Independent review | Luna/medium chat `01a0e1fe-a466-7810-9892-71009a512cc2` | Read-only exact candidate checkouts | V03 static spec/quality PASS; P01 correction review active in free subagent |
| U03 old dispatch | Superseded draft, no usable chat ID | `/Users/maak/.codex/worktrees/1221/polytray`, `3a3b13c` | Preserved unreviewed alternative; active owner is the registered layout chat |
| P01 old dispatch | Superseded draft, no usable chat ID | `/Users/maak/.codex/worktrees/861a/polytray`, `b9701b5` | Preserved unreviewed alternative; active owner is the registered slicer chat |

Active agents use separate dependency copies. Current dispatch baseline: `c6868e7`.
App-level/Electron checks use a serial coordinator lane; units/builds can run concurrently.
The three original worktree-chat requests never returned usable task IDs. Later repository inspection found completed draft commits in their worktrees, recorded above; they are preserved and superseded rather than silently merged. The working coordination route creates a managed worktree first, then a local project chat instructed to operate exclusively in that isolated checkout. Four implementation chats and one read-only review chat are now registered, in addition to the three subagents. All active implementations have private dependency copies. P01 and P03 are explicitly allowed concurrently because their source ownership is disjoint.

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

## Blockers and decisions

Execution is active. The default Python native-rebuild issue is resolved by selecting `/usr/bin/python3`; no package change was needed. Both foundation tasks and their review corrections are integrated. P02 is explicitly allowed alongside the pending P01 request because their files are disjoint. The V1 export format now separates current and pending annotation arrays to preserve overlapping values; imports merge only after preview. Approved defaults are in `contracts.md`; any contract revision must be coordinated before consumer dispatch. Graph tooling was unavailable during the audit; future agents must check its availability/freshness and otherwise use source fallback rather than claiming graph coverage. The existing marketing/media changes are unrelated and must remain intact.

## Completion evidence checklist

- [ ] Every audit finding is mapped to a completed task and passing regression.
- [ ] All producer/consumer wiring and runtime contracts are integrated.
- [ ] Data-loss, stale-result, and restore interruption tests pass.
- [ ] Query, first-result, idle-render, cancellation, and resource measurements are recorded.
- [ ] Build + Product pass on the integrated result; supported-platform coverage is recorded.
- [ ] Documentation describes the implemented behavior and remaining limits accurately.
- [ ] User receives the final evidence and chooses any next publication step.
