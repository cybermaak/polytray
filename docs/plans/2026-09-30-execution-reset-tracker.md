# Product-first restart tracker

Updated October 1, 2026. Authority: [execution plan](2026-09-30-execution-reset-plan.md).
**P00/P01 complete; P02 temporarily accepted by user at <=400ms Windows scan heartbeat. P03 DONE scoped; P04 onward and automation remain paused.**

One Sol/high owner performs implementation, self-review and focused verification.
One independent reviewer is reserved for P05, after the coherent product candidate.
The former R00-R09 queue is replaced by the stages below; do not execute its old
harness-first ordering.

## Checkpoint

- P00 baseline: codex/independent-access-review fast-forwarded e601afc -> cdf7967;
  that fetch had no later incoming delta. Reviewed CI stability report read once.
- Six original dirty patches saved in `.agent-tmp/restart-p00/all-six.patch`;
  separate preview, superseded-candidate and WAL128 patches retained there.
- Incoming thumbnail wait and streaming-anchor fix replace the old three test/helper
  patches; those are preserved in scratch, not stacked. Preview CSS/regression WIP
  is incorporated by P01. WAL128 is measured/rejected and excluded from candidate.
- Authoritative restart documents copied from primary; candidate AGENTS/DEV_CONTEXT
  adopt staged policy without primary marketing/user hunks.
- Graph MCP unavailable: Verify-tier source fallback; no graph coverage claimed.
- Mixed scan-streaming assertions: functional first-subtree-before-release, exact
  5,000 result, queue bounds and eventual completion; numeric first-query/card <1s,
  heartbeat <=250ms (temporary Windows <=400ms) and progress rate <=4/s. Responsive loading/layout/focus are
  functional checks. No assertions moved; any minimal split belongs to P04.
- P01 passes focused local macOS/Windows checks. P02 is temporarily user-accepted
  at <=400ms Windows scan heartbeat; the database stall is not fixed. DB-WORKER-01
  owns the deferred architectural repair. WAL128 remains rejected. P04 is unrun.
- Application scan/database source remains unchanged; the two scan tests now apply
  only the explicit Windows budget exception. No transient diagnostic tooling remains.
  WAL128 stays in saved scratch. P03 is DONE scoped; P04 onward/automation are paused.

## Stage A/B: product completion and minimum honest quality gate

| ID | Work | Depends on | State |
| --- | --- | --- | --- |
| P00 | Reconcile incoming work and adopt staged gate policy | Explicit resume | DONE |
| P01 | Finish small-window preview fix | P00 | DONE (focused macOS + Windows) |
| P02 | Record Windows scan responsiveness disposition | P00 | USER-ACCEPTED TEMPORARILY <=400ms; DB-WORKER-01 deferred |
| P03 | Fix only blockers to functional verification | P01, P02 | DONE scoped; no additional repair demonstrated |
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
| DB-WORKER-01 | [Dedicated SQLite worker and ordered messaging](2026-10-01-db-worker-01-brief.md) | Separate bounded architecture iteration; P02 temporary allowance | DEFERRED |
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

| P01 local | Preserved CSS: min 160px stage, scrollable footer capped 45%; reachability in both themes | Fresh global build/typecheck; responsive E2E 1 pass/18 combinations (27s); final both-theme check 1 pass (25s) reused build; screenshots inspected | P04 broad gate pending | 900x600 viewer 256px in both themes; 1280/1920 loading, widths and focus contracts pass. Local checkpoint; hosted result is recorded below. Evidence `.agent-tmp/restart-p01/local-evidence` |

| P01 hosted | Application repair c497457; diagnostic host SHA f3bc82e | Windows Node 22.23.3 / Electron 34.5.8; responsive E2E passed all 18 combinations, both-theme footer reachability, browse-width/focus; screenshots inspected | [Focused Build 36959173713](https://github.com/cybermaak/polytray/actions/runs/36959173713) | DONE scoped; 900x600 viewer 220px both themes (local macOS 256px). Hosted whole run is RED due to P02. No full Product/platform acceptance claimed |
| P02 | Default versus WAL128, serial private apps on the same Windows runner | Exact 5,000 persisted rows both; baseline max heartbeat 372.16ms / scan after held-subtree release 17,468ms; WAL128 303.24ms / 38,902ms | Unchanged heartbeat <=250ms target FAILS both | UNRESOLVED; reject WAL128: ~2.23x scan time and residual stall. No production DB change |

### P02 causal assessment before user disposition

The same-run baseline isolates synchronous transaction-boundary work, rather than
large SQL bodies or notifications: the longest index transaction was 360.83ms,
with 3.35ms inside its callback and 357.45ms outside (BEGIN/COMMIT wrapper). A
295.59ms metadata transaction spent 0.17ms inside (lookup 0.09ms, row/index update
0.03ms, revision 0.06ms) and 295.40ms at the boundary. No notification observation
exceeded the 20ms recording threshold. The default WAL was ~4.1-4.3MB at these
stalls; WAL128 was ~0.9MB and still had a 287.65ms index transaction with a 3.84ms
body and 283.79ms boundary. The WAL128 sample retains the last 100 slow SQL phases,
so phase counts are bounded diagnostics, not exhaustive totals.

This supports commit/checkpoint I/O as the dominant cause and excludes SQL/index
body work and notification as the dominant measured phases. Automatic checkpointing
is a strong inference, consistent with SQLite's documented committing-thread behavior
and WAL thresholds; this probe does not distinguish individual filesystem sync calls,
BEGIN versus COMMIT, or directly time a checkpoint. See
[SQLite WAL performance/automatic checkpoints](https://www.sqlite.org/wal.html).
No durability settings, annotations/pruning fences or timing targets were relaxed.

Reassessment after ~15 minutes of active P02 investigation: one setup-only hosted
failure (CRLF probe insertion; no app launched) and one informative controlled
baseline/change run. Do not pursue more speculative thresholds. The next decision is
a separately bounded design for checkpoint ownership versus moving synchronous DB
writes off the main thread, retaining durability, bounded WAL growth, cancellation
and shutdown behavior. At that checkpoint P02 was unresolved pending repair/decision. The later explicit user
disposition below supersedes its acceptance status; no P03/P04 work had been started.

Raw evidence remains in `.agent-tmp/restart-p00/windows-run2.log`,
`baseline-measurement.json`, `wal128-measurement.json` and `windows-run2/` artifacts;
local screenshots/18-case measurements are `.agent-tmp/restart-p01/local-evidence/`.
First setup failure: [36959010951](https://github.com/cybermaak/polytray/actions/runs/36959010951).
Temporary probe and dispatch changes are retained only as scratch
`hosted-probe.patch` / `retained-windows-probe.mjs`; removed from final candidate.
Local runtime was Node 25.9.0; hosted runtime was the incoming Node 22 pin. Focused
workflow contract checks: 21/21 passed, and both LF/CRLF instrumented source typechecks
passed. Broad functional gate remains P04; independent review remains P05.

### October 1 user-approved acceptance and deferred architecture

The user explicitly accepts Windows scan heartbeat <=400ms temporarily and directs
moving database operations to a worker_thread later. P02 is accepted by policy with
architectural optimization deferred; no performance fix is claimed. Both scan E2Es
(streaming 5k and large-OBJ metadata) use this Windows budget; macOS/Linux remain250ms.
Assertion and streaming failure-diagnostic trigger share the same named budget.
C10's [dated exception](2026-09-26-performance-ux/contracts.md#october-1-2026-temporary-windows-scan-exception)
retains unrelated budgets. DB-WORKER-01's [brief](2026-10-01-db-worker-01-brief.md)
records connection ownership, transaction-level messaging, ordering/backpressure,
revision/recovery fences and <=250ms long-term evidence goals. No worker is implemented.

Reused measurement: Windows baseline372.16ms heartbeat fits400ms; transaction
boundary357.45ms is distinct. Historical953/1,672ms outliers still exceed400ms, and
runs36878833124/36786572780/36959173713 retain their original failed conclusions.
P03 selection: latest reviewed full run36878833124 has only preview and scan failures;
current focused Windows run36959173713 confirms preview passes. No additional blocker
was demonstrated by that evidence. Check current isolated preview-cancellation/cleanup,
integrated600-row paging/restore, streaming scan and metadata scan locally, one invocation;
repair only an actual observed failure. No full suite/matrix or H/C backlog work.

| Acceptance/backlog | Windows scan budget400ms only; C10 dated exception and both scan tests; DB-WORKER-01 brief | Platform budget/boundary smoke: Windows400, macOS/Linux250; 372.16/400 accepted, >400 and historical953/1,672 rejected; assertion/diagnostic use same budget; local links/diff check pass | Historical Windows baseline reused, no new Windows run claimed | P02 USER-ACCEPTED TEMPORARILY; architecture DEFERRED, not a performance fix |
| P03 | Current failure evidence reviewed; no additional fixture/cleanup/product repair demonstrated | One fresh build/typecheck; `npm run test:product:e2e -- tests/product/e2e/scan-streaming.e2e.ts tests/product/e2e/metadata-worker.e2e.ts tests/product/e2e/preview-cancellation.e2e.ts tests/product/e2e/integrated-library.e2e.ts`: 4/4 PASS (19.9s including build); private profiles/SQLite/synthetic libraries | P04 broad gate unrun | DONE scoped; STOP before P04. No stable-harness or cross-platform pass claim |

P03 local evidence is `.agent-tmp/restart-p03/focused-functional.log` (macOS arm64,
Node25.9.0/Electron34.5.8). Streaming scan first card215.7ms before release, max
heartbeat30.39ms under unchanged250ms budget, exact5,000 result, discovery/metadata
high water50/100 and regular progress4/s. Integrated600-row paging/annotations/archive
preview/backup-restore and obsolete-parser cancellation plus exact-owned cleanup passed.
No unit/native rebuild or full matrix was needed for the policy/docs-only application
scope. Existing Electron ABI was retained, global setup built once, and generated fixture
ZIP was restored to its known SHA256. Historical Windows cleanup/tail-card flakes remain
harness residuals without a current failing reproduction; Windows live-disappearance,
manual cross-platform UAT and previous evidence limitations remain disclosed. P04/P05
are untouched. Primary user changes remain untouched; automation stays paused.
