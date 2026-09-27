# Performance and UX task tracker

[Execution plan](../2026-09-26-performance-ux-execution-plan.md) | [Shared contracts](contracts.md) | [Handoff template](handoff-template.md)

**Execution authorized:** Luna agents at medium reasoning, isolated worktrees, task commits, and coordinator integration into local main. No push to origin/main without explicit user permission. F01/F02 are running in isolated worktrees; all other tasks remain dependency-gated. An independent validator is capturing the pre-integration baseline.

**Progress:** 0 / 33 DONE. Foundation 0/2; data 0/3; scanning 0/6; thumbnails 0/4; preview 0/5; browsing 0/6; product workflows 0/4; validation 0/3.

## Status and update rules

- `PLANNED`: specified, not started. `READY`: authorized and all listed dependencies are DONE. `IN_PROGRESS`: one named owner is implementing. `REVIEW`: implementation exists; verification/review/integration remains. `BLOCKED`: a concrete external dependency or required decision prevents progress. `DONE`: task acceptance, in-scope wiring, review, and evidence are complete.
- Only the coordinator edits this tracker. Workers report through task-specific handoffs. A task may provide a completed service/component before a separately tracked consumer task integrates it; its own contract tests and required adapter wiring must still pass. Do not claim the later user journey is complete early.
- On dispatch, set owner, checkout/branch if used, and start status; add the handoff link in Evidence. On completion record commands/results and review in that handoff, then set DONE. Review dependencies before selecting the next READY task.
- Every implementation task requires the owning scope and contracts from its spec. A failing cross-stream integration returns to the responsible owner; record new blockers and contract changes here. Do not silently widen a worker's file ownership.
- After authorization, **F01 and F02 are initially eligible**. Recompute readiness from dependencies, not row order. Tasks in the same file-owning stream remain serial even if both are dependency-ready.

## Task register

| ID | Task specification | Priority | Dependencies | Status | Owner | Evidence / handoff |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | [Contracts and preview seam](foundation-data.md#f01---freeze-contracts-and-extract-the-preview-seam) | Foundation | - | IN_PROGRESS | Luna/medium | Pending handoff |
| F02 | [Fixtures and diagnostics](foundation-data.md#f02---establish-portable-fixtures-and-trustworthy-diagnostics) | Foundation | - | IN_PROGRESS | Luna/medium | Pending handoff |
| D01 | [Indexed scopes and batched writes](foundation-data.md#d01---indexed-folder-membership-and-a-batched-write-repository) | P1 | F01, F02 | PLANNED | Unassigned | - |
| D02 | [Complete SQL display pages](foundation-data.md#d02---query-complete-display-pages-in-sqlite) | P1 | D01 | PLANNED | Unassigned | - |
| D03 | [Independent library summaries](foundation-data.md#d03---separate-library-summaries-from-list-queries) | P2 | D02 | PLANNED | Unassigned | - |
| S01 | [Safe enumeration and pruning](scanning.md#s01---require-proof-of-successful-enumeration-before-pruning) | P1 | F01, F02 | PLANNED | Unassigned | - |
| S02 | [Streaming discovery and early batches](scanning.md#s02---stream-discovery-and-commit-useful-batches-early) | P1 | S01, D01 | PLANNED | Unassigned | - |
| S03 | [Background metadata extraction](scanning.md#s03---move-metadata-cpu-work-out-of-the-main-process) | P1 | S02 | PLANNED | Unassigned | - |
| S04 | [Dimensions and units](scanning.md#s04---correct-dimensions-units-and-measurement-provenance) | P2 | S03 | PLANNED | Unassigned | - |
| S05 | [Watcher ordering and thumbnail availability](scanning.md#s05---index-watcher-changes-before-thumbnail-work-and-preserve-ordering) | P1 | D01, S03, T01 | PLANNED | Unassigned | - |
| S06 | [Scan controls and targeted retry](scanning.md#s06---add-explicit-scan-job-pause-cancellation-and-targeted-retry) | P2 | S02, S03, S05 | PLANNED | Unassigned | - |
| T01 | [Thumbnail identity and settlement](thumbnails.md#t01---make-thumbnail-requests-and-cache-identities-settle-correctly) | P1 | D01 | PLANNED | Unassigned | - |
| T02 | [Authoritative refresh and cache reset](thumbnails.md#t02---make-refresh-clear-and-cache-version-reset-authoritative) | P1 | T01 | PLANNED | Unassigned | - |
| T03 | [Shared path-only thumbnail presentation](thumbnails.md#t03---keep-file-state-path-only-and-share-thumbnail-reads) | P1 | F01, F02 | PLANNED | Unassigned | - |
| T04 | [Thumbnail queue controls and accounting](thumbnails.md#t04---centralize-thumbnail-queue-state-controls-and-retry-accounting) | P2 | T02 | PLANNED | Unassigned | - |
| V01 | [Viewer lifetime and idle rendering](preview.md#v01---give-each-viewer-a-lifecycle-and-stop-drawing-when-idle) | P2 | F01, F02 | PLANNED | Unassigned | - |
| V02 | [Stable preview state and lazy archive navigation](preview.md#v02---decouple-metadata-from-geometry-and-show-durable-preview-states) | P2 | V01, D02 | PLANNED | Unassigned | - |
| V03 | [Owned cancellable preview runtime](preview.md#v03---cancel-obsolete-parsing-through-an-owned-preview-runtime) | P2 | F01, F02 | PLANNED | Unassigned | - |
| V04 | [Background preparation and bounded assembly](preview.md#v04---prepare-orientation-in-the-background-and-budget-visible-mesh-assembly) | P2 | V01, V03, S04 | PLANNED | Unassigned | - |
| V05 | [Progressive part thumbnails](preview.md#v05---make-part-thumbnails-small-progressive-and-independent) | P2 | V04 | PLANNED | Unassigned | - |
| U01 | [Complete browsing and consistent selection](browsing.md#u01---load-every-result-and-keep-selection-consistent-across-pages) | P1 | D02, T03 | PLANNED | Unassigned | - |
| U02 | [Search state and targeted refresh](browsing.md#u02---unify-search-state-and-refresh-only-what-changed) | P2 | U01, D03 | PLANNED | Unassigned | - |
| U03 | [Responsive panel layout](browsing.md#u03---keep-browsing-usable-at-every-supported-window-size) | P2 | F01, F02 | PLANNED | Unassigned | - |
| U04 | [Keyboard navigation and focus](browsing.md#u04---support-keyboard-navigation-and-predictable-focus) | P2 | U01, U03, V02 | PLANNED | Unassigned | - |
| U05 | [Background work UI and watch preferences](browsing.md#u05---present-useful-progress-and-respect-watcher-preferences) | P2 | U02, S06, T04 | PLANNED | Unassigned | - |
| U06 | [Workflow and measurement UI integration](browsing.md#u06---integrate-slicer-backuprestore-and-honest-measurements) | P2 | U04, P01, P02, P04, S04 | PLANNED | Unassigned | - |
| P01 | [Local slicer and archive handoff](product.md#p01---add-explicit-local-slicer-handoff-including-zip-members) | P2 | F01, F02 | PLANNED | Unassigned | - |
| P02 | [Versioned metadata export](product.md#p02---export-complete-versioned-metadata-backups) | P2 | F01, F02 | PLANNED | Unassigned | - |
| P03 | [Deterministic import preview](product.md#p03---preview-imports-and-compute-deterministic-mergeconflict-results) | P2 | P02, D01 | PLANNED | Unassigned | - |
| P04 | [Recoverable restore transaction](product.md#p04---apply-restores-with-crash-recovery-across-both-stores) | P2 | P03, S02 | PLANNED | Unassigned | - |
| G01 | [Integrated correctness and recovery](validation.md#g01---prove-integrated-correctness-and-recovery) | Gate | U05, U06, V05 | PLANNED | Unassigned | - |
| G02 | [Performance and resource evidence](validation.md#g02---verify-performance-and-resource-budgets) | Gate | G01 | PLANNED | Unassigned | - |
| G03 | [Documentation and readiness](validation.md#g03---reconcile-documentation-and-hand-back-execution-results) | Gate | G02 | PLANNED | Unassigned | - |

## Active assignments

| Assignment | Agent | Worktree / branch | Model |
| --- | --- | --- | --- |
| F01 | f01_foundation | `/Users/maak/.codex/worktrees/polytray-foundation/polytray` / `codex/perf-f01` | gpt-6-luna / medium |
| F02 | f02_fixtures | `/Users/maak/.codex/worktrees/polytray-fixtures/polytray` / `codex/perf-f02` | gpt-6-luna / medium |
| Baseline Build + Product (passed) | baseline_validation | `/Users/maak/.codex/worktrees/polytray-review/polytray` / `codex/perf-review` | gpt-6-luna / medium |

Each worktree has its own dependency copy, so native Node/Electron rebuilds cannot affect another installation. Baseline for these checkouts: `3d95fd3`. No push is authorized.

## Integration log

| Date | Task / checkpoint | Result | Follow-up |
| --- | --- | --- | --- |
| 2026-09-26 | Planning | Execution plan and tracker prepared | Complete |
| 2026-09-26 | Execution authorization | Concurrent Luna/medium worktrees, commits, and local-main integration approved | F01/F02 dispatched; independent baseline validation running; no origin/main push |

| 2026-09-26 | Baseline gate | Build PASS; 57 unit tests and 29 E2E tests PASS; 1 optional real-model test skipped | [Report](handoffs/baseline-validation.md); use `PYTHON=/usr/bin/python3` for native rebuilds |

## Blockers and decisions

No implementation blocker has been established because execution has not begun. The proposed defaults are in `contracts.md`; the user may change them before dispatch. Graph tooling was unavailable during the audit; future agents must check its availability/freshness and otherwise use source fallback rather than claiming graph coverage. The existing marketing/media changes are unrelated and must remain intact.

## Completion evidence checklist

- [ ] Every audit finding is mapped to a completed task and passing regression.
- [ ] All producer/consumer wiring and runtime contracts are integrated.
- [ ] Data-loss, stale-result, and restore interruption tests pass.
- [ ] Query, first-result, idle-render, cancellation, and resource measurements are recorded.
- [ ] Build + Product pass on the integrated result; supported-platform coverage is recorded.
- [ ] Documentation describes the implemented behavior and remaining limits accurately.
- [ ] User receives the final evidence and chooses any next publication step.
