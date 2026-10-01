# Paused restart task tracker

Authority: [execution reset plan](2026-09-30-execution-reset-plan.md).
**PAUSED: no tasks below are dispatched.** Documentation preparation does not
resume implementation, agents, tests, CI, or the hourly supervisor.

Owner on resume: one Sol/high implementation and verification agent. Independent
review is reserved for R08. Existing completed fixes stay completed; this queue
does not replay the original 33 tasks.

## Current checkpoint

- Repair branch: `codex/independent-access-review`, worktree
  `/Users/maak/.codex/worktrees/independent-access-review/polytray`, HEAD `e601afc`.
- Six dirty files recorded in the plan; no reset, stash, cleanup or integration
  was performed while preparing these documents.
- Last committed local gate: Build, 495 unit passes/74 E2E passes, expected skips.
- Hosted evidence: macOS/Linux passed together at `567e5e1`; latest `e601afc`
  Linux passed while macOS/Windows failed. No all-platform final green candidate.
- Current next action: user reviews this plan and decides whether to resume.
- Outstanding policy choice: adopt staged gate scheduling in R00. Any change to
  numeric performance/platform acceptance requires a separate explicit decision.

## Queue and dependencies

| ID | Type | Deliverable / owning scope | Depends on | State |
| --- | --- | --- | --- | --- |
| R00 | Process | One-owner instructions, preserved WIP inventory, verification ledger | User resume | PLANNED |
| R01 | Harness repair | Close proven fixture/anchor/refresh gaps; confirm independent setup | R00 | PLANNED |
| R02 | Product fix | Small-window preview repair and focused UI proof | R01 | PLANNED |
| R03 | Verification tooling | Focused platform/suite CI without packaging | R00 | PLANNED |
| R04 | Bounded analysis | Remove duplicate builds only if a narrow safe change | R03 | PLANNED |
| R05 | Product investigation/fix | Windows synchronous scan-write attribution and bounded repair | R03 | PLANNED |
| R06 | Focused acceptance | Validate Windows fixes; classify remaining platform failures | R01, R02, R05 | PLANNED |
| R07 | Final gates | Frozen integration tree, full Product/matrix and UAT evidence | R06; R04 disposition | PLANNED |
| R08 | Independent review | One combined source/feature/evidence review and delta repair loop | R07 | PLANNED |
| R09 | Handoff | Local integration, accurate G02/G03 statuses and final report | R08 | PLANNED |

Execution is serial even when dependencies permit another order. Recommended
order is R00, R01, R02, R03, R04, R05, R06, R07, R08, R09. R04 can be recorded
DEFERRED with rationale; it must not become a broad harness rewrite.

## Task briefs and acceptance

### R00 - Establish one owner and an honest checkpoint

Read current Git state and user instructions; snapshot the six dirty-file patches
in task scratch before separating them. Classify CSS/UI tests, Mac fixture changes,
and WAL experiment independently. No blind revert or staging unrelated user edits.
Make the new process discoverable from project instructions while preserving the
existing user changes; keep pre-main-push Build/Product and native order intact.
Update the verification ledger with existing reusable exact-tree evidence. Do not
start another worker/coordinator or a reviewer. **Gate:** path/status/patch inventory,
explicit command timing, no source/test execution needed merely to inventory.

### R01 - Finish only the demonstrated harness gaps

Own pending changes in `background-work.e2e.ts`, `thumbnail-invalidation.e2e.ts`
and `gridFailureEvidence.ts`, plus minimal directly affected helper changes.
Retain the already reviewed branch's independent recovery/slicer fixtures and
main-window helper; check for omissions rather than rewrite every test. Preserve
exact IDs, mostly-visible anchor and <=2px documented rounding tolerance, refreshed
path identity and image-content assertions. A fixture change must not hide a real
lost selection or stale image. **Gate:** affected tests pass; recovery cases can run
individually; bounded repeated run only for the previously intermittent cases
(reuse the existing ten-repeat anchor evidence if unchanged). No full Product yet.

### R02 - Give the preview usable space at small sizes

Own pending `styles.css` and `responsive-layout.e2e.ts` changes. Reuse existing RED
zero/50px stage evidence. Validate stage >=160px for the reported case, working
preview and reachable footer controls in both themes at 900x600; inspect larger
sizes for regression. Preserve sidebar/browse-width contracts. **Gate:** current
build, responsive E2E plus affected focus checks, selected screenshots. No new UI
features, separate worker, or intermediate independent reviewer.

### R03 - Add a small focused CI entrypoint

Own a minimal workflow/runner adapter and relevant `tests/repo/ci` contracts.
Inputs choose OS and a finite suite such as scan-streaming, responsive-preview,
workflow-recovery or watcher. Default Build continues to run the full matrix;
Release is unchanged. A focused run must build current code, generate fixtures,
prepare correct native runtime, run selected real Electron tests and retain failure
artifacts. Do not run packaging or all-platform tests in focused mode. No arbitrary
shell-command input. **Gate:** contract RED/GREEN, syntax checks, one sandbox
validation of a selected suite on its selected OS. Record this as focused evidence,
never a full Product pass. Reuse the workflow's tested isolation/Openbox setup.

### R04 - Decide whether duplicate-build removal is worth doing

Inspect `app.e2e.ts` and `viewer-idle.e2e.ts` embedded builds and current orchestration.
Use existing timing/logs before running new benchmarks. Bound analysis to 30 minutes.
If safe, move build ownership to one entrypoint with fresh-output preflight and
working standalone suite commands. Never depend on test-file order or share native
modules between checkouts. **Gate if changed:** orchestration contract plus one
standalone consumer and one combined invocation proving build happens once. If the
change needs broad runner redesign, record DEFERRED and proceed; do not spend a
full matrix solely to optimize test runtime.

### R05 - Attribute the Windows scan stall before tuning SQLite

Own `database.ts`, narrowly related scan/index diagnostics and the focused scan
test. Preserve the dirty 128-page WAL experiment outside the accepted baseline.
Use current timing evidence (315ms metadata span near329ms heartbeat gap), query
and transaction boundaries, WAL state and runner conditions to distinguish causes.
Run a controlled before/after on the same hosted Windows setup; at most two focused
diagnostic attempts per hypothesis. Retain <=1s early visibility, <=250ms heartbeat,
exact5000 rows, annotations/pruning safety and queue bounds. Assess total scan time
and checkpoint I/O, not just one lucky heartbeat sample. **Gate:** a causal fix plus
focused behavior/unit coverage and Windows proof, or an explicit evidence-backed
unresolved finding with the decision needed. No durability weakening or speculative
checkpoint change accepted on documentation theory alone.

### R06 - Close the remaining focused platform evidence

Use R03 to run only affected Windows scan, responsive-preview and any still-failing
restore/watcher cases. For failures, distinguish primary defects from cleanup or
worker-restart cascades; reuse complete failure artifacts. Do not reproduce fixed
Linux lifecycle work unless affected. **Gate:** exact candidate passes the selected
cases, with limitations recorded; no timing/fixture/assertion changes silently
waive a contract. Keep Windows restart-offline versus live disappearance explicit.

### R07 - Freeze and validate one integration candidate

Reconcile all task commits into one candidate with no speculative WAL setting or
unexplained test changes. Run required Build/Product once and full hosted matrix
once on the same relevant tree; preserve native order. Verify synthetic UAT journeys:
browse/search beyond page500, keyboard End/focus, small preview, replacement/cancel,
scan controls, thumbnails/refresh, archive handoff with mock slicer, backup/restore
and interrupted recovery. Reuse existing current-tree journey tests; do not create
a duplicate UAT suite. Capture representative screenshot evidence and inspect it.
**Gate:** passing agreed matrix, evidence tuple, fixture restored, no orphan task
processes. If a fresh failure arises, return to its owner/cause and use focused
verification before another broad run. Report human UAT as unperformed where true.

### R08 - One final independent acceptance review

Freeze source; dispatch one independent reviewer with the original scope, current
baseline/candidate, risk map and evidence index. Review actual source and feature
outcomes, especially file access, persistence, scan/watch races, process signalling
and test semantics. No separate spec/quality agents and no unchanged suite reruns.
Worker remains sole writer for fixes; reviewer checks affected deltas. **Gate:**
all blocking findings fixed/verified or explicitly accepted by the user; nonblocking
comments do not expand into unrelated cleanup. Do not call automated review human UAT.

### R09 - Integrate and hand back without publication

Mechanically integrate the accepted candidate to local main with user edits excluded.
Verify relevant tree identity to reuse tests; any behavioral merge change invalidates
affected evidence. Reconcile the original tracker, G02/G03, README/DEV_CONTEXT and
one final report. Keep prior failures and profile-isolation incident disclosed.
**Gate:** accurate final SHA, tests/CI links, screenshots, explicit residuals and user
changes preserved. No origin/main push, release or website action. Stop for the
user's next decision; do not invent additional optimization work.

## Minimal execution log (populate only after resume)

| Task | Candidate | Change / hypothesis | Focused gate | Broad gate reused/due | Outcome / evidence |
| --- | --- | --- | --- | --- | --- |
| - | e601afc + six preserved dirty files | Paused starting state | Existing evidence only | Final matrix remains due | No execution authorized by this document |
