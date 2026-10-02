# Product-first restart tracker

Updated October 1, 2026. Authority: [execution plan](2026-09-30-execution-reset-plan.md).
**P00-P02 resumed explicitly in the fresh sole-owner chat. P03 onward and automation remain paused.**

One Sol/high owner performs implementation, self-review and focused verification.
One independent reviewer is reserved for P05, after the coherent product candidate.
The former R00-R09 queue is replaced by the stages below; do not execute its old
harness-first ordering.

## Checkpoint

- Candidate: codex/independent-access-review fast-forwarded e601afc -> cdf7967;
  fetched remote has no later delta. Reviewed CI stability report read once.
- Six original dirty patches saved in `.agent-tmp/restart-p00/all-six.patch`;
  separate preview, superseded-candidate and WAL128 patches retained there.
- Incoming thumbnail wait and streaming-anchor fix replace the old three test/helper
  patches; those are preserved in scratch, not stacked. Preview CSS/regression WIP
  is carried forward. WAL128 is excluded from candidate until justified.
- Authoritative restart documents copied from primary; candidate AGENTS/DEV_CONTEXT
  adopt staged policy without primary marketing/user hunks.
- Graph MCP unavailable: Verify-tier source fallback; no graph coverage claimed.
- Mixed scan-streaming assertions: functional first-subtree-before-release, exact
  5,000 result, queue bounds and eventual completion; numeric first-query/card <1s,
  heartbeat <=250ms and progress rate <=4/s. Responsive loading/layout/focus are
  functional checks. No assertions moved; any minimal split belongs to P04.
- External Windows preview and heartbeat failures remain open; full gate is P04.

## Stage A/B: product completion and minimum honest quality gate

| ID | Work | Depends on | State |
| --- | --- | --- | --- |
| P00 | Reconcile incoming work and adopt staged gate policy | Explicit resume | DONE |
| P01 | Finish small-window preview fix | P00 | LOCAL PASS; Windows proof pending |
| P02 | Resolve demonstrated Windows scan responsiveness defect | P00 | PLANNED |
| P03 | Fix only blockers to functional verification | P01, P02 | PLANNED |
| P04 | Frozen product-quality milestone and affected performance measurement | P03 | PLANNED |
| P05 | One independent final code/feature/UAT review | P04 | PLANNED |
| P06 | Local integration and truthful product handoff | P05 | PLANNED |

Execute serially in this order. P01 and P02 need not wait for general harness work.
A blocked P02 investigation does not prevent preparing P03/P04 evidence for completed
features, but no unresolved product blocker is disguised as accepted.

### P00 - Reconcile, preserve and specify the gate

Owner: sole worker. Scope: candidate branch, six dirty patches, project instructions
and one checkpoint. Preserve WIP to task scratch before merging/rebasing incoming
cdf7967; keep unrelated user files out. Compare the old anchor/thumbnail patches
with their external replacements rather than applying both. Preserve the WAL experiment
separately until P02 proves it. Adopt one-owner/final-review rules and the test schedule
in AGENTS/workflow docs without committing user hunks. List functional assertions versus
numeric performance assertions that currently share tests; propose only minimal
separation at P04, never blanket test exclusion. Gate: coherent baseline, conflict
resolution/self-review and relevant narrow checks for actual changed behavior. Do not
run the entire suite merely to inventory the branch.

### P01 - Finish the actual preview layout repair

Scope: styles.css, affected preview layout, responsive-layout.e2e.ts. Reuse the private
RED zero/50px stage evidence and pending CSS candidate. At 900x600 require a usable
preview area (candidate minimum 160px), successful tiny-STL preview and reachable footer
controls in both themes. Inspect 1280x800/1920x1080 for overflow/browse-width regression.
Gate: build once if stale, focused responsive/focus cases and representative screenshots.
No separate reviewer or full matrix at this task boundary. Hosted Windows proof is
collected with P04 or a single focused run if needed to resolve a Windows-only cause.

### P02 - Fix the Windows stall with causal evidence

Scope: synchronous database/scan-write path and its focused regression. Start from
315ms metadata write/329ms heartbeat evidence and latest 953 ms external miss. Establish
whether checkpoint, transaction/index work, notification or I/O is responsible. Compare
baseline/one bounded change in the same environment; use existing diagnostics first.
Do not accept WAL128 merely because it looks plausible. Preserve durability, annotation
safety, pruning fences and exact row counts; record total scan time as well as latency.
Gate: causal explanation, affected correctness regression and one selected scan
measurement. Full performance suites wait for milestones. Stop after 45 minutes or two
uninformative diagnostic attempts and record the actual next decision; no diagnostic
framework or repeated matrix expansion. A persistent real UI stall remains a product
finding even if numeric benchmarks are scheduled outside the ordinary gate.

### P03 - Minimum changes needed to verify the product

Scope: only a demonstrated blocker in the selected functional checks. Prefer external
fixes already present. Examples: expired/old thumbnail value, exact target navigation,
per-test missing backup, wrong main window, private scratch ENOTEMPTY after process exit.
Add no generic abstraction unless repeated consumers demonstrably need it. Preserve
primary errors and ensure cleanup waits for the exact owned process. Gate: original
failure reproduced or exact artifact cause established, repaired focused case passes,
neighboring affected behavior checked. Everything else enters H/M/C queues below.
A 30-minute investigation checkpoint prevents this task becoming whole-harness repair.

### P04 - One coherent product-quality milestone

Freeze the candidate. Run full functional units/integration/E2E and the required
platform functional matrix once, building once per environment with the correct
Node->unit->Electron->E2E sequence. Reuse representative existing UAT journeys: paging,
search/selection, keyboard focus, preview replace/cancel, scan/thumbnail controls,
archive mock-slicer handoff, metadata export/import and interrupted recovery. Inspect
screenshots; do not create another parallel UAT framework.

Measure only the changed scan/preview performance paths at this milestone; put broad
benchmark calibration/repetition in M01/M02. If functional/timing assertions are mixed,
make the smallest explicit gate separation: retain correctness/cleanup assertions,
move numeric benchmarks intact to a scheduled nonblocking report, and record the new
workflow scope. If that cannot be done narrowly, use the existing gate and disclose
its exact red results instead of claiming all green or building a large runner.

Gate: a genuinely green, named functional gate on the same source/test/config tree,
no hidden product failures, and a separate honest performance result. If the unchanged
Build job is red, it is still red; never label all CI green. Follow-up repairs use
focused checks before another justified full milestone run.

### P05 - One independent review at final acceptance

One independent reviewer, only after all product tasks have reached the milestone.
Review actual code and feature/UAT evidence, changed assertion semantics, file access,
data recovery, cancellation/process ownership and identified user-facing defects.
Return one consolidated severity-ranked list. Worker owns fixes; reviewer rechecks the
affected delta only. No per-task spec/quality agents or repeated unchanged broad tests.
Gate: no unresolved blocking product/review finding, or explicit user disposition.
Do not call agent inspection human UAT or expand cosmetic comments into a cleanup project.

### P06 - Integrate locally and separate completed from deferred

Integrate the accepted tree without user edits; verify relevant tree identity to reuse
validation. Update original G02/G03 ledger accurately and provide current SHA, gate/CI
links, screenshots and a short remaining-work list. Report product-quality acceptance
separately from pending performance targets and whole-harness reliability. Do not
mark original requirements met simply because tests were moved. Keep profile incident
and platform/security limitations disclosed. No main push or publication.

## Stage C: separately scheduled stabilization and code work

These tasks do not run during product completion unless a specific finding is promoted
to a demonstrated blocking product defect. Keep analyses bounded and fixes small.

| ID | Task / concrete output | Entry condition | State |
| --- | --- | --- | --- |
| H01 | Correct stability reports: top-level errors, missing/partial repetitions and estimation caveats | Before using stability report for decisions | DEFERRED |
| H02 | Stabilize common fixture/setup/cleanup/navigation failure classes in one dedicated batch | Product milestone complete; recurring failures inventoried | DEFERRED |
| H03 | Assess splitting large scenarios/shared app state; keep/change/defer plan then smallest useful patch | H02 evidence shows coupling still causes failures | DEFERRED |
| H04 | Improve focused CI/run selection using existing workflow; conservative defaults, no duplicate runner | Repeated scoped execution has proven friction | DEFERRED |
| M01 | Define performance stage policy and per-environment calibration from existing evidence | Product milestone measurements available | DEFERRED |
| M02 | Dedicated common-performance iteration and scheduled benchmark evidence | M01; specific prioritized bottleneck | DEFERRED |
| C01 | Investigate cached scroll-anchor layout/query invalidation | Product complete, unless targeted repro proves blocker sooner | DEFERRED |
| C02 | Bounded code/test-hook simplification with risk map and behavior preservation | Product complete; measurable maintenance benefit | DEFERRED |

**H01 acceptance:** a report with Playwright teardown/global errors cannot claim a 100%
full-run green result. Missing reports or incomplete requested repetitions are visible.
Use small pure unit tests. The product-of-pass-rates estimate must state independence
and sample-size limits; do not mistake five passing attempts for proven stability.

**H02/H03 acceptance:** choose the most common cause across current failed artifacts;
make tests independent of prior test actions and require actual settled user state.
Consider background-work's multi-scenario test, responsive-layout's 18 reload cycles,
and app.e2e's 33 shared-state tests only where evidence warrants splitting. Validate
standalone plus a small combined run. No all-suite repeats on every edit.

**H04 acceptance:** reuse incoming platform/grep selection where callable. The new
Stability workflow is not dispatchable until registered on default branch; do not push
main merely to enable it. Use few repetitions/one platform by default and enumerate
supported scopes. Keep native prerequisites, global build and failure-only evidence.
Do not add a new scheduler, telemetry framework or arbitrary shell input.

**M01/M02 acceptance:** document milestones, reference hardware, fixture, sample count,
median/p95, heartbeat, total throughput and budgets separately from noisy hosted
runners. Preserve functional early-batch-before-held-subtree, eventual completion,
stale-publication and cleanup checks in product tests. Reference threshold misses
remain open until fixed or explicitly accepted; no silent widening. Perform benchmarks
at the planned iteration/release stages, not each commit. Group common bottlenecks
before one measurement run; no speculative tuning from one slow sample.

**C01/C02 acceptance:** first prove the issue or maintenance benefit. C01 covers changing
columns/row size/query while cached anchor state survives. C02 may separate production
behavior from test hooks using existing seams, but cannot remove Linux termination
ownership checks, cache fences or recovery state merely to reduce code/tests. No
whole-codebase refactor. Targeted regressions and a final batch check only.

## Execution record (populate only after explicit resume)

| Task | Candidate / change | Focused verification | Milestone due/reused | Result / next action |
| --- | --- | --- | --- | --- |
| P00 | cdf7967 imported; six patches preserved/reconciled; staged rules adopted | Remote delta/review, patch comparison and diff check | P04 pending | DONE; P01 next |

| P01 local | Preserved CSS: min 160px stage, scrollable footer capped 45%; reachability in both themes | Fresh global build/typecheck; responsive E2E 1 pass/18 combinations (27s); final both-theme check 1 pass (25s) reused build; screenshots inspected | P04 broad gate pending | 900x600 viewer 256px in both themes; 1280/1920 loading, widths and focus contracts pass. Hosted proof remains pending. Evidence `.agent-tmp/restart-p01/local-evidence` |
