# Polytray restart plan: product first, verification at milestones

Updated October 1, 2026 after the user's clarification and the external CI work.

## Authority and current state

**P00-P02 are complete with the temporary P02 disposition below; P03 is explicitly resumed.**
The fresh owner completed acceptance/backlog updates and P03 with focused checks.
P04 onward and hourly automation remain paused.

The objective is to finish the product and fix demonstrated product problems with
minimal necessary verification overhead, obtain an honest green product-quality
result, and then tackle broader harness stability, performance calibration and code
cleanup as separate iterations. The concern is unnecessary repeated execution and
harness complexity, not test count. Existing useful tests are retained and scheduled
where they provide evidence.

One Sol/high owner implements, self-reviews, verifies and integrates. There are no
per-task reviewer agents. One independent reviewer checks the completed product
candidate and feature/UAT evidence at the acceptance milestone. Subsequent review
is limited to fixes of its actual findings, not a fresh audit after every edit.

This supersedes the September 30 ordering that put harness construction and CI
plumbing ahead of product fixes, and the older two-reviewers-per-task process.
Staged test timing below replaces per-commit broad validation. No publication,
origin/main push, real user-profile/library/slicer tests or remote Windows/Linux
Codex setup is authorized. Preserve unrelated user changes and all paused work.

## Reconcile the external work; do not repeat it

Reviewed incoming branch: `origin/ci/sandbox` at `cdf7967`, fetched but not merged
into local main or the paused repair checkout. Its review is
[CI stability review](https://github.com/cybermaak/polytray/blob/cdf7967/docs/plans/2026-10-01-ci-stability-review.md).
It descends from paused repair HEAD `e601afc` and already includes:

- One global E2E build, removal of duplicate per-file builds, native rebuild-marker
  correction, Node 22 CI setup, and the rule against concurrent native tests.
- Real content changes for watcher fixtures, deterministic debounce timers, a
  refreshed-thumbnail path wait, and consolidation of two duplicated E2E cases.
- A reproduced streaming-scroll anchor fix and corresponding unit/E2E coverage.
- PR CI, retained failure evidence, and a manual platform/grep stability workflow.

These are incoming completed changes, not new implementation tasks. Confirm their
relevant tree and evidence once when importing. Do not rebuild the same helpers,
reapply the old anchor patch, or redo their entire investigation.

Paused checkout remains
`/Users/maak/.codex/worktrees/independent-access-review/polytray`, branch
`codex/independent-access-review`, HEAD `e601afc` with six dirty files. Preserve
patches before reconciliation: database.ts, styles.css, background-work.e2e.ts,
responsive-layout.e2e.ts, thumbnail-invalidation.e2e.ts, gridFailureEvidence.ts.
The old anchor/thumbnail patches may be superseded by the external changes. The
CSS repair is a product candidate; `wal_autocheckpoint = 128` is an unverified
experiment, not an accepted optimization. Do not silently merge that experiment.

Latest reviewed external CI passed macOS/Linux; Windows retained preview loading
and a 953ms scan heartbeat gap. Historical local passes or different SHAs' platform
passes do not establish a green final candidate. The original 31/33 ledger remains
historical; use the [revised tracker](2026-09-30-execution-reset-tracker.md) for remaining work.

## Delivery stages

### Stage A - Finish the product

1. Import/reconcile the reviewed external changes and preserve unresolved WIP.
2. Finish the small-window preview repair: the reported zero-height viewer is a
   real product defect. Keep controls reachable and browsing usable.
3. Record the Windows synchronous scan finding and the explicit temporary <=400ms
   scan-heartbeat disposition. Defer the architectural repair to DB-WORKER-01;
   do not micro-tune checkpoint/synchronization settings.
4. Make only the small fixture or cleanup corrections required to verify those
   product changes and critical user journeys. No general harness rewrite.

Each task closes with self-review and focused checks, then the owner moves on.
No full unit suite, Product run, platform matrix or external review is triggered
merely by a commit, an intermediate patch, or a status update.

### Stage B - Obtain an honest product-quality pass

Freeze a coherent candidate. Execute one planned functional integration gate on
that tree, collect representative UAT/screenshot evidence, and perform one final
independent code/feature review. Fix specific blocking findings with focused checks.
Repeat broader validation only when relevant candidate changes invalidate it.

The product-quality gate covers data correctness, persistence/recovery, IPC and
file-access boundaries, working user journeys, functional preview/scan behavior,
no stale publication, and bounded resource ownership/cleanup. A stuck preview,
lost annotations or orphaned renderer is a product defect, not performance noise.

Tight numeric benchmarks are scheduled at explicit performance milestones below;
they are not run as pass/fail assertions on every edit or every ordinary PR push.
Keep actual completion/cancellation and cleanup checks in the functional gate.
Do not equate a noisy timing miss with an exempted functional failure.

**Truthful green rule:** name the gate and candidate that passed. Do not call the
existing Build workflow or the entire suite green while it still has failures.
If benchmark assertions currently share tests with correctness checks, extract
only the timing assertions into the scheduled performance lane; retain functional
assertions in the product lane and report both results. Record every moved test,
assertion and target. Tests are rescheduled, not deleted or silently skipped.

Any gate split must be minimal and transparent. If it needs substantial runner
work, use the existing gate for the one milestone attempt, report the exact open
results, and park the broader change in Stage C. Do not spend an open-ended
iteration building infrastructure just to produce a green badge.

### Stage C - Separate harness, performance and code-stability iterations

After product acceptance, address common reliability and maintenance issues in
bounded batches, rather than discovering and fixing one test per full CI matrix:

- Harness reliability and cost: shared-state isolation, large scenario tests,
  navigation, fixture lifecycle, scoped CI selection and evidence completeness.
- Performance: reference measurements, hosted-runner calibration, throughput and
  resource trends. Fix demonstrated common bottlenecks in a dedicated iteration.
- Code stability: bounded simplification of test hooks, ownership seams and code
  health, with behavior-preserving regressions. Do not turn this into a rewrite.

These are explicit follow-up tasks. They do not automatically block a passing
product-quality milestone. An actual data-loss/security/lifecycle defect found in
any stage is promoted to a product blocker with concrete evidence.

## Exactly when verification runs

| Trigger | Run | Do not run automatically |
| --- | --- | --- |
| One edit while reproducing/fixing | Failing regression and directly affected neighboring cases | Whole unit suite, Product, all platforms, reviewers |
| Coherent source task closes | Self-review; focused unit/integration tests; build only if needed for current app output | Full performance suite or repeated stability runs |
| UI behavior changed | Existing affected E2E flow and one relevant screenshot/layout check | Every viewport/theme/feature journey |
| Windows/Linux-specific unknown | One affected case/suite on the affected platform | All-platform matrix and packaging |
| Pure docs change | Links, status consistency, diff check; applicable docs checks | Build, native rebuild, Product, CI |
| Product-complete candidate (Stage B) | Build once; full functional unit/integration/E2E gate; required platform functional matrix; representative UAT evidence | Benchmark repetition or general harness redesign |
| Final independent review | One reviewer of source, behavior and collected evidence | Separate spec and quality agents; duplicate test execution |
| Review finding repaired | Regression and affected gate; reuse unchanged evidence | Rerun all platforms solely because a reviewer commented |
| Performance milestone | Selected reference/per-platform benchmark suite, once per coherent data-path batch | Timing benchmarks on every commit |
| Dedicated stability iteration | Small known-flaky subset, selected platform, bounded repetitions | Default whole-suite repeats on all OSes |
| Actual authorized main push/release candidate | Required final gates in project instructions and explicit permission | Publication inferred from green tests |

Performance milestones are: (1) completion of the current scan/preview product
fixes, only their affected measurements; (2) the planned Stage C common-performance
iteration; and (3) a future explicitly authorized release-readiness measurement.
At milestone 1, record numeric results even if the functional gate passes. An
unresolved timing target stays open in the performance ledger; it cannot be called
met merely because it no longer executes in the ordinary product gate. Root-cause
reproductions of a performance bug may measure the affected path during iteration;
that is not permission to run every benchmark.

C10 reference values remain recorded, with hardware/runtime/fixture provenance.
Changing their value or claiming full original G02 acceptance still needs an
explicit acceptance decision. This user-directed scheduling change does not
require resolving every benchmark before reporting the narrower product milestone.

## Commands and execution rules

- The incoming global setup builds once for an E2E invocation. Do not add per-file
  builds or perform an immediately duplicated build/typecheck. Reusing a build via
  `POLYTRAY_E2E_SKIP_BUILD=1` requires verified current source/output.
- Focused units: `node scripts/run-node-tests.mjs <exact test paths>` with Node
  native dependencies ready. Focused E2E: existing Playwright file/title selection
  with current fixtures and Electron native dependencies ready.
- `npm run test:e2e:changed` is advisory: Electron-loaded application changes are
  not fully traced, and the far-behind origin/main may select nearly everything.
  Select tests from the actual changed behavior rather than trusting it as coverage.
- Full Product remains Node native rebuild -> marker invalidation -> units ->
  Electron native rebuild -> E2E. Never alternate ABIs underneath another command.
  One checkout, one test lane; never share native node_modules between worktrees.
- Use incoming CI selection where available. The new Stability workflow requires
  default-branch registration before dispatch; no main push is authorized to enable
  it. Do not make that workflow a prerequisite for ordinary product work. If a
  scoped hosted check is essential now, add only minimal selection to an existing
  authorized workflow or use one deliberate full milestone run.
- Do not launch five-repeat/all-platform stability defaults as a routine check.
  Start with the affected test, one platform and the minimum useful repetitions.
- Rerun after a relevant change or a stated diagnostic question, not to obtain a
  lucky green result. Keep failure artifacts and disclose transient failures.

On resume, P00 reconciles project instructions to this schedule, preserving user
hunks and recording any functional/performance gate separation before executing it.
Do not silently keep older per-task full-suite/reviewer rules in force alongside
this plan. No test scripts or workflow behavior have changed during this doc update.

## Minimal harness work now versus dedicated work later

**Now, only when it blocks product verification:** reuse isolated-profile launches,
known main-window selection, per-test recovery fixtures and exact-target navigation.
Repair a specific stale-result wait or exact-process scratch cleanup failure. Use
existing screenshots/logs/state probes; add one decisive missing observation only.
Preserve functional assertions. A short cleanup grace period may account for an
exited process's file handles; swallowing app shutdown failure or leaking a live
process is not an acceptable cleanup fix.

**Later:** shared-state redesign of the 33-test app suite; splitting the eight-scenario
background test and 18-cycle responsive test; broad removal of production test hooks;
new telemetry, generalized fake environments, a complete fixture abstraction, and
whole-suite flake statistics. Analysis tasks must produce a keep/change/defer decision
and a small next patch, not an automatic refactor.

External-review follow-ups are classified separately:

- Stability summary ignores top-level Playwright errors: confirmed reporting defect,
  assigned H01. It blocks trusting that report, not unrelated product implementation.
- Cached scroll anchor retains column/row geometry across layout changes: source-level
  risk, not a reproduced GUI defect. C01 investigates once; promote only on evidence.
- Windows cleanup and tail-card flakiness: fix narrowly in P03 only if they block the
  product milestone; systematic reliability work belongs to H02.
- The external streaming-anchor fix replaces the earlier theory that all observed
  anchor failures were merely overscan/rounding. Keep its real regression coverage.

## Cost and stopping controls

One current checkpoint and one evidence ledger; do not maintain many parallel
narratives. Record task, candidate, changed paths, focused command/result, duration,
next action and blocker. Keep raw logs in scratch and summarize, not copy full histories.

A task brief specifies one cause, one expected behavior and one gate. Investigation
checkpoint after 45 minutes of active analysis or two targeted diagnostic attempts
without decisive new evidence. Reassess or continue another useful product task;
do not escalate automatically into a new full matrix or a complex probe framework.

Plan one full functional milestone matrix. If it fails, group common causes, repair
an evidenced batch, run affected cases, then recheck the candidate. Record why each
extra broad run is necessary. Final performance/stability numbers and account-wide
usage are different metrics; do not invent task credit totals from the account meter.

Automation remains paused. If explicitly re-enabled later, use compact status checks,
leave active work undisturbed, and intervene only for genuine drift/blockage. Main
push/publication and remote-machine setup remain outside authorization.

## Acceptance and residuals

Product completion, green functional validation, measured performance, harness
stability and code cleanup are separate statuses. A single passing run is evidence
for that candidate, not proof the entire harness is stable. The final independent
review covers product code and feature outcomes; later maintenance batches do not
reopen it without behavior changes.

Retain existing safety tests for file access, transactional recovery, stale-result
fences and process ownership. Moving tight timing assertions must not remove their
functional coverage. Keep the Linux orphan fix: it solved real shutdown behavior,
not just a numeric target. Do not rework it without a concrete new defect.

Keep disclosed limitations: Windows restart-with-missing-root is tested; uninterrupted
live disappearance is not. Remote manual Windows/Linux UAT is deferred. The historical
107ms multipart observation, parent-directory race, PID-reuse TOCTOU and accidental
host-profile probe remain documented. No claim of all original G02/G03 requirements
being met is made solely from the new product-quality milestone.

## October 1 user disposition: P02 allowance and database-worker backlog

The user accepts a temporary Windows **scan main-heartbeat maximum <=400ms**, with
macOS/Linux remaining <=250ms and the long-term reference goal <=250ms unchanged.
The controlled Windows baseline of 372.16ms meets this policy; the separate 357.45ms
transaction-boundary duration is not the heartbeat metric. Historical 953/1,672ms
outliers and failed CI runs remain failures. No broader suite/platform green result
is inferred. C10's dated exception records the exact scope; query p95, query heartbeat,
preview-cancellation 500ms and early-visible 1s limits are unchanged.

P02 is **user-accepted temporarily; architectural optimization deferred**, not a
fixed database stall. Keep the default database and checkpoint behavior; WAL128 was
rejected after 38.9s versus 17.5s scan time and residual heartbeat failure. DB-WORKER-01
moves database operations into a dedicated Node worker_thread owning SQLite, using
bounded transaction-level messaging. It includes blocking reads/index work where
relevant. The [focused brief](2026-10-01-db-worker-01-brief.md) defines safety and
measurement requirements; design/implementation needs its own bounded iteration.
P03 now handles only demonstrated blockers to functional verification. P04 remains
unrun and is a separate authorization/milestone; P05 remains the independent review.

## October 2: P04 explicit resume

The user authorizes P04's frozen-candidate full local Product gate and one hosted Build
matrix, current runtime/build and representative automated synthetic UAT evidence.
This supersedes the earlier P04 pause only. P05/P06, deferred DB-WORKER/H/M/C work,
automation, main push and publication remain paused. Retain the approved Windows scan
heartbeat <=400ms and all other budgets; do not label historical failures green.
