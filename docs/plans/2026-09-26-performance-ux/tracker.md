# Performance and UX task tracker

[Execution plan](../2026-09-26-performance-ux-execution-plan.md) | [Shared contracts](contracts.md) | [Handoff template](handoff-template.md)

**Execution authorized:** Luna agents at medium reasoning, isolated worktrees, task commits, and coordinator integration into local main. No push to origin/main without explicit user permission. F01, F02, S01, V01, and the P02 export service are reviewed and integrated. D01 is completing common wiring and its combined app gate; V03 is implementing independently. P02's renderer revision binding, pending-annotation provider, and user-facing export action remain explicitly owned by P04/U06. T03/U03/P01 chat creation remains pending registration.

**Progress:** 5 / 33 DONE. Foundation 2/2; data 0/3; scanning 1/6; thumbnails 0/4; preview 1/5; browsing 0/6; product workflows 1/4; validation 0/3.

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
| D01 | [Indexed scopes and batched writes](foundation-data.md#d01---indexed-folder-membership-and-a-batched-write-repository) | P1 | F01, F02 | IN_PROGRESS | d01_index_repository (Luna/medium) | Core reviewed; adapters at `a743a79` in review; common wiring/app gate in progress |
| D02 | [Complete SQL display pages](foundation-data.md#d02---query-complete-display-pages-in-sqlite) | P1 | D01 | PLANNED | Unassigned | - |
| D03 | [Independent library summaries](foundation-data.md#d03---separate-library-summaries-from-list-queries) | P2 | D02 | PLANNED | Unassigned | - |
| S01 | [Safe enumeration and pruning](scanning.md#s01---require-proof-of-successful-enumeration-before-pruning) | P1 | F01, F02 | DONE | s01_safe_scanning (Luna/medium) | [S01](handoffs/S01.md); both reviews and runtime gate passed |
| S02 | [Streaming discovery and early batches](scanning.md#s02---stream-discovery-and-commit-useful-batches-early) | P1 | S01, D01 | PLANNED | Unassigned | - |
| S03 | [Background metadata extraction](scanning.md#s03---move-metadata-cpu-work-out-of-the-main-process) | P1 | S02 | PLANNED | Unassigned | - |
| S04 | [Dimensions and units](scanning.md#s04---correct-dimensions-units-and-measurement-provenance) | P2 | S03 | PLANNED | Unassigned | - |
| S05 | [Watcher ordering and thumbnail availability](scanning.md#s05---index-watcher-changes-before-thumbnail-work-and-preserve-ordering) | P1 | D01, S03, T01 | PLANNED | Unassigned | - |
| S06 | [Scan controls and targeted retry](scanning.md#s06---add-explicit-scan-job-pause-cancellation-and-targeted-retry) | P2 | S02, S03, S05 | PLANNED | Unassigned | - |
| T01 | [Thumbnail identity and settlement](thumbnails.md#t01---make-thumbnail-requests-and-cache-identities-settle-correctly) | P1 | D01 | PLANNED | Unassigned | - |
| T02 | [Authoritative refresh and cache reset](thumbnails.md#t02---make-refresh-clear-and-cache-version-reset-authoritative) | P1 | T01 | PLANNED | Unassigned | - |
| T03 | [Shared path-only thumbnail presentation](thumbnails.md#t03---keep-file-state-path-only-and-share-thumbnail-reads) | P1 | F01, F02 | READY | Unassigned | - |
| T04 | [Thumbnail queue controls and accounting](thumbnails.md#t04---centralize-thumbnail-queue-state-controls-and-retry-accounting) | P2 | T02 | PLANNED | Unassigned | - |
| V01 | [Viewer lifetime and idle rendering](preview.md#v01---give-each-viewer-a-lifecycle-and-stop-drawing-when-idle) | P2 | F01, F02 | DONE | f01_foundation + s01_safe_scanning (Luna/medium) | [V01](handoffs/V01.md); reviewed and integrated through `cb63f7a` |
| V02 | [Stable preview state and lazy archive navigation](preview.md#v02---decouple-metadata-from-geometry-and-show-durable-preview-states) | P2 | V01, D02 | PLANNED | Unassigned | - |
| V03 | [Owned cancellable preview runtime](preview.md#v03---cancel-obsolete-parsing-through-an-owned-preview-runtime) | P2 | F01, F02 | IN_PROGRESS | s01_safe_scanning reassigned (Luna/medium) | Isolated preview runtime implementation |
| V04 | [Background preparation and bounded assembly](preview.md#v04---prepare-orientation-in-the-background-and-budget-visible-mesh-assembly) | P2 | V01, V03, S04 | PLANNED | Unassigned | - |
| V05 | [Progressive part thumbnails](preview.md#v05---make-part-thumbnails-small-progressive-and-independent) | P2 | V04 | PLANNED | Unassigned | - |
| U01 | [Complete browsing and consistent selection](browsing.md#u01---load-every-result-and-keep-selection-consistent-across-pages) | P1 | D02, T03 | PLANNED | Unassigned | - |
| U02 | [Search state and targeted refresh](browsing.md#u02---unify-search-state-and-refresh-only-what-changed) | P2 | U01, D03 | PLANNED | Unassigned | - |
| U03 | [Responsive panel layout](browsing.md#u03---keep-browsing-usable-at-every-supported-window-size) | P2 | F01, F02 | READY | Unassigned | - |
| U04 | [Keyboard navigation and focus](browsing.md#u04---support-keyboard-navigation-and-predictable-focus) | P2 | U01, U03, V02 | PLANNED | Unassigned | - |
| U05 | [Background work UI and watch preferences](browsing.md#u05---present-useful-progress-and-respect-watcher-preferences) | P2 | U02, S06, T04 | PLANNED | Unassigned | - |
| U06 | [Workflow and measurement UI integration](browsing.md#u06---integrate-slicer-backuprestore-and-honest-measurements) | P2 | U04, P01, P02, P04, S04 | PLANNED | Unassigned | - |
| P01 | [Local slicer and archive handoff](product.md#p01---add-explicit-local-slicer-handoff-including-zip-members) | P2 | F01, F02 | READY | Unassigned | - |
| P02 | [Versioned metadata export](product.md#p02---export-complete-versioned-metadata-backups) | P2 | F01, F02 | DONE | s01_safe_scanning (Luna/medium) | [P02](handoffs/P02.md); producer reviewed/integrated `e1c66e8`, `6de841f`; consumer binding P04/U06 |
| P03 | [Deterministic import preview](product.md#p03---preview-imports-and-compute-deterministic-mergeconflict-results) | P2 | P02, D01 | PLANNED | Unassigned | - |
| P04 | [Recoverable restore transaction](product.md#p04---apply-restores-with-crash-recovery-across-both-stores) | P2 | P03, S02 | PLANNED | Unassigned | - |
| G01 | [Integrated correctness and recovery](validation.md#g01---prove-integrated-correctness-and-recovery) | Gate | U05, U06, V05 | PLANNED | Unassigned | - |
| G02 | [Performance and resource evidence](validation.md#g02---verify-performance-and-resource-budgets) | Gate | G01 | PLANNED | Unassigned | - |
| G03 | [Documentation and readiness](validation.md#g03---reconcile-documentation-and-hand-back-execution-results) | Gate | G02 | PLANNED | Unassigned | - |

## Active assignments

| Assignment | Worker | Worktree / branch | State |
| --- | --- | --- | --- |
| D01 | d01_index_repository, Luna/medium | `/Users/maak/.codex/worktrees/polytray-foundation/polytray` / `codex/perf-d01` | Wiring and serialized app verification |
| V03 | s01_safe_scanning reassigned, Luna/medium | `/Users/maak/.codex/worktrees/polytray-review/polytray` / `codex/perf-v03` | Implementing |
| P02 | Completed; checkout available after review | `/Users/maak/.codex/worktrees/polytray-fixtures/polytray` / `codex/perf-p02` | Integrated producer; no active writer |
| T03 | New Luna/medium chat requested | Client `eec1883f-42d5-4431-ad0b-955c2867d1b1` | Worktree created; waiting for task registration |
| U03 | New Luna/medium chat requested | Client `0a22ffff-ae10-4583-a008-f381c43fc15d` | Worktree created; waiting for task registration |
| P01 | New Luna/medium chat requested | Client `530dfb9f-136d-417b-a4ea-610b0026ec0d` | Worktree created; waiting for task registration |

Active agents use separate dependency copies. Current dispatch baseline: `c6868e7`.
App-level/Electron checks use a serial coordinator lane; units/builds can run concurrently.
The three requested chat tasks do not yet have usable task IDs and are not counted as active implementations.

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
