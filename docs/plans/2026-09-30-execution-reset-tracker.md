# Product-first restart tracker

Updated October 2, 2026. Authority: [execution plan](2026-09-30-execution-reset-plan.md).
**P00/P01 complete; P02 temporarily accepted by user at <=400ms Windows scan heartbeat. P03 DONE scoped; P04 COMPLETE: required Product/Build gates green on 2b61aa1. P05 interaction fix is verified; P06 DONE locally; functional CI green with explicit Linux/Windows scan-timing report exceptions. Automation/deferred work remain paused.**

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
  owns the deferred architectural repair. WAL128 remains rejected. P04 gates now pass on 2b61aa1; details below.
- Application scan/database source remains unchanged; the two scan tests now apply
  only the explicit Windows budget exception. No transient diagnostic tooling remains.
  WAL128 stays in saved scratch. P03 is DONE scoped; P04 is complete; P05 onward/automation are paused.

## Stage A/B: product completion and minimum honest quality gate

| ID | Work | Depends on | State |
| --- | --- | --- | --- |
| P00 | Reconcile incoming work and adopt staged gate policy | Explicit resume | DONE |
| P01 | Finish small-window preview fix | P00 | DONE (focused macOS + Windows) |
| P02 | Record Windows scan responsiveness disposition | P00 | USER-ACCEPTED TEMPORARILY <=400ms; DB-WORKER-01 deferred |
| P03 | Fix only blockers to functional verification | P01, P02 | DONE scoped; no additional repair demonstrated |
| P04 | Frozen product-quality milestone and affected performance measurement | P03 | DONE: local Product and hosted Build matrix green on 2b61aa1 |
| P05 | One independent final code/feature/UAT review | P04 | DONE scoped: Astra finding fixed/verified; performance exceptions explicit |
| P06 | Local integration and truthful product handoff | P05 | DONE scoped: normal local merge of6fdb549 with source equivalence and preserved user work |

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

### October 2: P04 authorized and candidate frozen

Baseline774b07c was clean. Freeze the same app/test/config tree with this status-only
checkpoint and execute local Node22 Product plus one exact-SHA ci/sandbox Build matrix.
Use existing full gates; no gate split or timing changes. Global E2E setup builds once
for the test phase; no duplicate manual build. The unchanged hosted packaging action
also rebuilds JS as its existing packaging prerequisite. Record that packaging outcome
separately rather than alter the workflow during this milestone. Native sequence:
Node rebuild -> stale marker cleanup -> units -> Electron rebuild -> E2E. All GUI tests
use explicit private Chromium/userData/DB and synthetic libraries/mock slicer. Inspect
existing responsive screenshots and feature journeys as automated evidence, not human UAT.
P05/P06, deferred architecture/stability work and automation are not authorized here.

### October 2: P04 complete, one frozen milestone attempt

Validated candidate: **2b61aa1d4488fdc6b3fec2b71cb9447ad86ab03f**, same app/test/config
as774b07c; only P04-active status documentation changed before freeze. Local full
Product and [Build37011206604](https://github.com/cybermaak/polytray/actions/runs/37011206604)
are **GREEN** on that exact candidate. The later completion checkpoint changes only
documentation; no application, test, workflow, dependency or budget correction/retry
was needed. No numeric assertion was moved or relaxed. Windows scan400ms is the
previously explicit temporary exception; historical953/1,672ms failures stay red.

| Environment / runtime | Unit phase | E2E phase | Build/typecheck | Packaging |
| --- | --- | --- | --- | --- |
| Local macOS26.6.2 arm64 / Node22.23.3 / Electron34.5.8 | 499 pass, 1 platform skip | 72 pass, 1 optional skip (3.0m) | PASS, one global E2E build | Not run locally |
| [Hosted macOS26 arm64](https://github.com/cybermaak/polytray/actions/runs/37011206604/job/110851122601) / Node22.23.2 | 499 pass, 1 platform skip | 72 pass, 1 optional skip (6.2m) | PASS | DMG and macOS ZIP PASS; signing skipped |
| [Hosted Ubuntu24.04 x64](https://github.com/cybermaak/polytray/actions/runs/37011206604/job/110851122941) / Node22.23.3 | 499 pass, 1 platform skip | 72 pass, 1 optional skip (10.6m) | PASS | AppImage PASS |
| [Hosted Windows Server2025 x64](https://github.com/cybermaak/polytray/actions/runs/37011206604/job/110851122850) / Node22.23.3 | 499 pass, 1 platform skip | 72 pass, 1 optional skip (10.4m) | PASS | NSIS installer and portable EXE PASS |

Every Product gate preserved Node rebuild -> stale marker cleanup -> units ->
Electron rebuild -> E2E. Local Node22.23.3 was an official checksum-verified scratch
runtime (archiveSHA25672d5d8832b41c9d9646197af614ffd751406ea4d215060eb91b98864e1919a3e),
matching `.nvmrc` major22. Hosted macOS resolved the preceding22.23.2 patch; provenance
is recorded separately. The unchanged packaging action rebuilds JS after Product as
its existing prerequisite; no duplicate standalone build was added. No native/test
commands ran concurrently in a checkout. All GUI tests used explicit scratch Chromium
profiles/userData and private SQLite/synthetic fixtures; slicer launches were mocks.

Affected scan measurements from this milestone (one sample per environment):

| Environment | First card before held-subtree release | Main heartbeat maximum / accepted budget |
| --- | --- | --- |
| Local macOS | 212.6ms | 29.08 /250ms |
| Hosted macOS | 493.8ms | 112.41 /250ms |
| Hosted Linux | 252.3ms | 55.05 /250ms |
| Hosted Windows | 233.9ms | 270.64 /400ms temporary |

All scans assert exact5,000 completion, bounded discovery/metadata queues50/100 and
regular progress<=4/s. These are different hosts, not a controlled before/after speedup.
Current full-gate scan-total throughput is not separately instrumented; P02's controlled
17.5s default/38.9s WAL128 comparison remains historical evidence, not a new P04 value.
Windows still exceeds the desired250ms goal; DB-WORKER-01 remains deferred.

Automated synthetic UAT evidence reuses the full-suite journeys: paging/search/selection,
keyboard focus, preview replace/cancel, scan and thumbnail controls, chosen archive-member
mock-slicer handoff, metadata export/import/conflict/pending annotation handling and
interrupted renderer/SQLite restore recovery. All those existing cases passed. Local
responsive flow produced18 screenshots; four representative captures were visually
inspected across900x600/1280x800/1920x1080 and dark/light themes. Default viewer heights
were256.1/366.1/529.5px and browse widths640/660/1300px; minimum-size footer reachability
and overlay focus/scroll contracts passed. This is automated evidence, not human UAT.

Representative local captures (frozen2b61aa1):

- [900x600 dark](../../.agent-tmp/restart-p04/local-test-results/responsive-layout.e2e.ts-r-457fb-ross-supported-window-sizes/responsive-900x600-default-dark.png)
- [900x600 light](../../.agent-tmp/restart-p04/local-test-results/responsive-layout.e2e.ts-r-457fb-ross-supported-window-sizes/responsive-900x600-default-light.png)
- [1280x800 light](../../.agent-tmp/restart-p04/local-test-results/responsive-layout.e2e.ts-r-457fb-ross-supported-window-sizes/responsive-1280x800-default-light.png)
- [1920x1080 dark](../../.agent-tmp/restart-p04/local-test-results/responsive-layout.e2e.ts-r-457fb-ross-supported-window-sizes/responsive-1920x1080-default-dark.png)

Skipped/unperformed coverage remains explicit:

- Local/macOS/Linux unit skip: native Windows lowercase ancestor-scope enumeration.
  Windows executes that case but skips descriptor-open symlink-swap test because
  `O_NOFOLLOW` is unavailable there. No access safeguards were weakened.
- All E2E environments skip optional real `base.3mf`; no real library/profile/slicer used.
- Linux/Windows GPU timer-query extension was unavailable, so GPU elapsed/upload timing
  was not measured there; functional dense/multipart preview assertions still passed.
- Windows restart-with-missing-root/recovery passes; uninterrupted live disappearance
  remains unverified. Manual cross-platform UAT, reference performance/stability repeats,
  raw resource census, optional real-model evidence and signed/notarized release validation
  were not performed. macOS CI had no signing identity. Packaging is not publication.
- No separate lint/repo gate was added for status-only documents; required Product and
  hosted Build gates passed. One passing milestone does not prove harness stability or
  all original G02/G03 numeric/resource requirements. P05 independent review and P06
  integration are unstarted; H/M/C/DB-WORKER and automation remain deferred/paused.

Raw evidence: `.agent-tmp/restart-p04/local-product.log`, `local-report/`,
`local-test-results/`, `hosted-{macos,linux,windows}.log`, `hosted-final.json` and
`candidate-sha.txt`. Generated fixtureZIP restored to baseline
SHA2566ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109.
Primary7aab2d6 user hunks/untracked files remain untouched. STOP before P05.

### October 2: P05 finding and approved fix/P06 resume

Astra's read-only review of2b61aa1/docsbb98b62 found one blocker: restore locked the
renderer before draining a whole paused scan, making Resume/Cancel inaccessible.
The user approved simple scan exclusion, then P06. Sole Sol owner; no further agents,
reviewer cycle, deferred DB/harness work or automation. Three gate regressions first
failed with pending admission on the original source, then passed with scan admission
and idle-renderer checks. Production fix labels whole scans, bulk scans and retries;
rejects restore before locking if scan work exists; blocks new scans from queuing during
admission, rechecks attempts during the renderer handshake and releases lock/leases on
rejection. Initial Add Folder renderer operations reject an idle-required lock promptly.
UI keeps preview available but disables Apply for active/paused scans and pending retry.
Busy admission is recoverable, with no marker/journal/backup side effects; stale preview
may be regenerated. Focused units34/34 and affected isolated E2Es13/13 passed; expanded focused
units62/62 include real metadata retry/cancellation state. Previous P04 remains valid
for unaffected code but does not validate this changed restore/scan source. Final exact
Product/hosted candidate gate follows; primary user hunks remain untouched until safe P06.

Final-fix candidatee1bc384 local Product:507 unit passes/1 platform skip;72 E2E passes,
1 optional skip and one keyboard fixture failure at folder-path read after Settings
close. The trace/source shows deferred focus return via requestAnimationFrame; the
test waited for hidden overlay but not returned focus before another Tab journey.
A narrow added Settings-button focus assertion establishes that existing contract;
no product behavior/threshold changed. Exact focused keyboard case passes1/1 (2.9s).
The superseded CI37036970692 is cancelled after this concrete local diagnosis; a
corrected exact candidate gets the final Product/matrix gate. Original local failure,
trace and raw logs remain in `.agent-tmp/p05-fix/final-test-results` and `final-product.log`.

### Corrected final candidate4298174: fix verified; P06 disposition pending

Exact [Build37038058657](https://github.com/cybermaak/polytray/actions/runs/37038058657)
is **RED**, not a green final acceptance result. Local full Product passes507 units
plus1 platform skip,73 E2Es plus1 optional skip. Every hosted unit phase passes507
plus1 platform skip. macOS passes73 E2Es/1 optional skip and packaging. Linux/Windows
each pass72 E2Es/1 optional skip and fail only scan-streaming's heartbeat assertion;
packaging is skipped on those platforms. The new actual restore/paused-scan/direct-IPC/
admission-race E2E passes on all three OSes (macOS5.8s, Linux7.6s, Windows12.1s).

Linux heartbeat253.727ms exceeds unchanged250ms. Its metadata-apply244.613ms aligns
with the largest gap near indexed451. Windows heartbeat751.743ms exceeds the approved
400ms temporary limit; index-batch732.280ms near indexed4551 and metadata-apply620.028ms
near indexed2201 show retained synchronous database stalls. Both scans completed exactly
5,000 rows and passed early-visibility, queue, progress and cleanup assertions before
this numeric failure. No thresholds were changed, assertions rescheduled or lucky reruns
performed. Deferred DB-WORKER-01 remains outside this assignment.

The sole P05 interaction finding is fixed and self-reviewed with62 focused unit and13
affected E2E passes, plus the new case's three-platform proof. The unrelated keyboard
readiness correction passes focused and final local Product. This does not turn the
final matrix green. P06 local merge is held pending the user's explicit choice to
integrate with these timing failures retained as open findings, or require green CI.
No primary hunk was stashed/changed or integration begun. Raw matrix logs, diagnostics,
traces and responsive captures remain `.agent-tmp/p05-fix/{linux,windows}-failure/`,
`accepted-{linux,macos,windows}.log`, `accepted-ci-final.json` and `accepted-test-results/`.
The user decision was requested asynchronously; all main-push/publication/automation
restrictions and previous coverage/profile-isolation limitations remain in force.

### October 2 explicit answer: keep tests enabled; complete P06

The user answered the held decision: proceed with local integration and adjust only
scan heartbeat acceptance to Linux<=300ms, Windows<=850ms, macOS<=250ms. Chose this
narrow option, not disabling tests. Both scan E2Es retain every functional/data-safety
assertion, diagnostics and metric labels; all unrelated timing targets are unchanged.
C10/current instructions and DB-WORKER-01 record the provisional policy and required
worker-era controlled recalibration/stricter-budget restoration. Previous red matrix
37038058657 is not retroactively green. No DB tuning/worker/harness implementation.
Reuse4298174 local full Product for unchanged application logic; verify policy values
and boundaries, then one exact-candidate hosted full Build. P06 follows a normal merge
with tracked user-hunk backup/stash and restoration; untracked work stays in place.
The pending acceptance question is resolved by this explicit user answer.

Policy verification: both source declarations evaluate to Windows850/Linux300/macOS250;
inclusive boundaries accepted, boundary+0.001 rejected; assertion/diagnostic references
share the named budget. Normalized diff versus4298174 confirms all other E2E lines are
unchanged. Focused two scan E2Es pass2/2 (5.4s), with current application build reused
only after verifying application/dependency/workflow tree identity. No native ABI changes
or full local507-unit rerun for policy/docs; local4298174 Product proof remains valid
for unchanged application logic. New exact hosted candidate gate pending.

### October 2 clarified authorized fallback and real tail failure

Policy-only matrix37041710616: macOS/Linux507 units+73 E2Es pass and package; Windows
71 E2Es pass/2 fail/1 optional skip. New restore exclusion passes everywhere. Windows
heartbeat1495.502ms >850 (index-batch1483.854ms) remains an actual performance miss.
The parent relayed the existing human disable fallback: ONLY numeric scan ceilings
are now report-only on Linux/Windows, with300/850 comparisons, full samples/slow phases,
explicit targetMet/missed warnings; macOS250 stays gated. E2Es/functional/data safety,
measurement validity and unrelated budgets remain enabled/blocking. The pending timing
question is resolved by that explicit prior authorization, not a new approval request.

Windows integrated-library fails a real exact-tail interaction atline194: after target
visibility the tail toggle becomes unmounted; the pointer helper only polls a missing
node. It cannot be ignored. A controlled real wheel to the end reproduces unmounting;
then exact-ID wheel navigation must recover the target before a stable real pointer
hit and unchanged selection/pressed assertions. This is one narrow fixture/navigation
repair, not an app/harness redesign. Focused RED/GREEN evidence follows;30min checkpoint.
All failed/cancelled histories stay recorded. P06 still waits for non-waived gates.

Tail diagnosis completed within the30min checkpoint: controlled real-wheel unmount
reproduces the original2s missing-toggle failure (RED). Recovery derives the exact
known item row from current mounted grid geometry and uses bounded real wheel input;
then existing stable pointer hit/selected exact ID/pressed/count assertions run unchanged.
Focused integrated+two scan cases pass3/3 (14.7s). Gate policy checks confirm macOS250
gated, Linux300/Windows850 report-only, with finite/positive/sample checks still blocking
and no skips/continue-on-error. Application/dependency/workflow code matches4298174;
only disclosed test/report/navigation and docs changes invalidate those affected checks.
A coherent final exact-candidate functional matrix follows; no507-unit local rerun
solely for those test/doc changes. Previous failures stay recorded.

Functional matrix37045048450: Linux passes the controlled-tail regression and full
gate; macOS fails only background-work's later healthy-card visibility after a one-time
programmaticscrollTop0. Tail and restore regressions pass macOS. This assertion conflates
healthy record survival with a retained virtual-grid viewport settling after job completion.
Narrow correction checks exact healthy ID/content revision before/after retry and finds
it via normal search UI, then clears search. Earlier retained-scroll assertions remain
unchanged; no scroll-cache product fix is claimed. Focused background+controlled-tail
cases pass2/2 (21.4s). One coherent test-only correction follows; no app/budget changes,
no dropped functional assertions. Current failures remain recorded. P06 still waits for
non-waived green gate; no unbounded harness work.

The completed Windows job from37045048450 also found a recovery-readiness fixture race:
product-workflows readsettings.autoScan immediately after the shell became visible,
before its existing30s unresolved=false poll. It observed the oldtrue value during
legitimate roll-forward. Move that same recovery-resolved check before reading/restored
state assertions; no timeout/assertion or product logic changed. Windows controlled-tail
and restore exclusion cases passed; reported scan timing still missed comparison.
37047082224 was cancelled as superseded before accepting a partial platform result.
The coherent background+tail+all product-workflow focused set passes12/12 (31.8s),
including committed and acknowledgment-failure recovery. This consolidates the completed
platform findings into one narrow fixture batch before final matrix. No more general
harness expansion; subsequent unrelated failures require a bounded blocker decision.

### Final P06 local handoff (October 2)

Final exact-candidate [functional Build37047833281](https://github.com/cybermaak/polytray/actions/runs/37047833281)
is GREEN on6fdb549c8af6db18e1a54c0db5a3e32799c8b605: all three OSes507 unit passes,
1 platform skip;73 E2E passes,1 optional real-model skip; packaging passes. P05
restore exclusion, controlled tail remount, healthy record navigation and settled
restore recovery assertions pass all platforms. App logic/dependencies/workflows match
4298174 local full Product proof; only disclosed test/report/navigation/docs changed.
No test is disabled or blanket allow-failure used. Linux/Windows numeric scan ceilings
are report-only; full raw timing and missed warnings remain, macOS250 stays gated.
This is functional CI acceptance, not proof of resolved scan performance/harness stability.

Normal local merge from primary7aab2d6 retains main's newer workflow/historical evidence
and resolves only four document conflicts. Product/test/workflow/dependency tree is
compared to the exact tested candidate before evidence reuse. Three tracked user hunks
were saved via normal targeted stash and restored after the integration commit; untracked
marketing/superpowers files remain in place. No index-blob staging workaround, reset,
origin/main push, publication, real profile/library/slicer test or automation.
Original G03 documentation/handoff DONE; G02 REVIEW with DB-WORKER-01 and prior
performance/resource/manual-UAT/signing/optional coverage limitations retained.
Final integration/HEAD SHA and post-merge checks are recorded in the completion entry.

Primary post-merge pre-commit validation: build/typecheck PASS. Repo45 cases:43 pass,
2 existing workspace-hygiene failures (`.agent-tmp` exists despite the mandated scratch
convention; ignored `.DS_Store` exists). These paths existed before this integration;
no source/test contract altered, task/user artifacts not deleted to manufacture green.
Product/test/config indexed tree equals exactCI candidate6fdb549 byte-for-byte. Required
Product/functional Build gates green; repository hygiene result remains separately red.

### P06 completion SHA, exact equivalence and preservation

Normal local integration commit: `f21c6e8d56506d30915810deec80454ad344e95d` (main), combining primary7aab2d6
and exact tested6fdb549c8af6db18e1a54c0db5a3e32799c8b605. The staged and final working
product/test/workflow/build/dependency/config tree equals that tested candidate. Main's
historical reviews/UAT reports and newer public workflows remain; only four routine
document conflicts were reconciled. Source evidence is reused only for this verified
identity. Local primary build/typecheck passes; Repo43/45 reports two unchanged workspace
hygiene conditions (`.agent-tmp`, ignored `.DS_Store`) rather than a Product failure.

After normal targeted stash/apply, added/removed user delta lines match the original
AGENTS.md, DEV_CONTEXT.md and capture-readme-media.ts exactly. Untracked marketing and
superpowers path inventory is unchanged. Index clean; user hunks remain uncommitted.
Backup patch/original files/task stash retained; no index-blob staging workaround or reset.
No main push/publication, automation, real profile/library/slicer test or remote setup.

Final [Build37047833281](https://github.com/cybermaak/polytray/actions/runs/37047833281)
functional gate: eachOS507 unit passes/1 platform skip,73 E2E passes/1 optional skip,
packagingPASS (macOS unsigned DMG/ZIP, Linux AppImage, Windows NSIS/portable).
Measured scan heartbeat: macOS90.13ms (250 gated), Linux50.06ms (300 report-only,
targetMettrue), Windows441.68ms (850 report-only,targetMettrue). These different-host
samples are not a speedup claim. Windows still exceeds the desired250ms reference goal;
DB-WORKER-01 owns worker ownership/messaging and controlled latency/throughput/durability
proof, recalibration/restoration of strict numeric checks. Prior1495/751/253/953/1672ms
misses and red/cancelled histories remain recorded under their original criteria.

Important fixes/proof: e1bc384 scan-excluding restore admission;4298174 focus-return
readiness; d5fd38c exact-ID real-wheel tail remount;8866ea9 healthy ID/revision preservation
through real search;6fdb549 existing recovery-resolved wait before reading settings.
Application logic matches4298174 local full Product507 units/73 E2Es; affected policies/
fixtures verified by focused cases and exact current three-platform functional Build.
Astra's sole P05 interaction finding is resolved by regression/runtime evidence without
another reviewer cycle. G03 scoped docs/local handoffDONE (32/33 ledger);G02REVIEW.

Automated screenshots remain linked above (copied to primary task scratch); no human UAT
claim. Optional realbase.3mf, Windows O_NOFOLLOW unit skip, unsupported Linux/Windows GPU
elapsed timing, Windows uninterrupted live disappearance, manual cross-platform UAT,
signing/notarization, stability/reference repetitions/raw resource coverage and previously
recorded host-profile incident/parent-directory/PID-reuse residuals remain disclosed.
Completion changes after the integration commit are documentation only. Selected immutable
logs are copied to primary `.agent-tmp/p06-evidence/`; preservation proof is
`.agent-tmp/p06-preserved/`. P06 is complete; STOP. Deferred work/automation remain paused.
