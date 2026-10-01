# Polytray execution reset: one owner, staged verification, final review

## State and authority

**Implementation and hourly supervision remain PAUSED.** This document is the
requested process and restart plan, not permission to resume work, tests, CI,
review agents, or experiments. Only documentation was prepared during this pause.

The user's September 30 decision replaces the previous coordinator/worker and
per-task specification/quality-review cycle with:

1. One Sol/high agent implements, self-reviews, tests, and owns integration.
2. After a task passes its defined local gate, that same agent selects the next task.
3. One independent reviewer examines the coherent final code and feature/UAT
   evidence at the end. No routine intermediate reviewer agents.
4. The worker fixes final-review findings; the reviewer rechecks only the
   affected changes. Automated tests are evidence, not a substitute for this
   final fresh perspective; an agent's screenshot inspection is not human UAT.

On explicit resume, this process supersedes the per-task delegation/review
requirements in the September 27 sequential policy, Luna handoff, and applicable
skill workflow. It does not weaken product contracts or authorize publication.
The detailed verification scheduling below is the proposed policy to adopt in
R00; it makes the timing of mandatory checks explicit rather than deleting them.

No origin/main push, release, website publication, real library/slicer tests,
remote Windows/Linux Codex setup, or unrelated user-file changes are authorized.
The earlier user override allows justified non-main CI runs and automatic result
retrieval; ten minutes of live watching is not a reason to wait for a manual report.

## Frozen starting point

- Original implementation ledger: **31/33 accepted**. All 30 implementation
  tasks and G01 were accepted; G02 validation and G03 readiness remain open.
  This count is not a measure of remaining effort and does not certify new repairs.
- Active repair checkout:
  `/Users/maak/.codex/worktrees/independent-access-review/polytray`, branch
  `codex/independent-access-review`, committed HEAD `e601afc`.
- That committed tree passed local Build/Product: 495 unit passes and 74 E2E
  passes, with one expected unit skip and one optional real-model skip.
- Latest hosted run: [36789407775](https://github.com/cybermaak/polytray/actions/runs/36789407775).
  Linux passed; macOS had 72 passes/2 failures; Windows had 69 passes/5 failures.
  The preceding `567e5e1` candidate passed macOS and Linux, but Windows failed.
  Do not combine different SHAs' passes into a claim that one final matrix passed.
- Six uncommitted files remain. Preserve all before splitting anything:
  `src/main/database.ts`, `src/renderer/styles.css`,
  `tests/product/e2e/background-work.e2e.ts`,
  `tests/product/e2e/responsive-layout.e2e.ts`,
  `tests/product/e2e/thumbnail-invalidation.e2e.ts`,
  `tests/support/helpers/gridFailureEvidence.ts`.
- The database change sets `wal_autocheckpoint = 128`. It is an **unverified
  experiment**, not an accepted optimization. Its final verification was interrupted.
- Primary-checkout user edits in AGENTS.md, DEV_CONTEXT.md, marketing/capture
  files and untracked documentation remain excluded. Existing diagnostics and
  worktrees must not be deleted to satisfy a cleanliness test.

The restart task tracker is [execution-reset-tracker.md](2026-09-30-execution-reset-tracker.md).
It tracks finishing work; it does not replace or reset the original 33 task IDs.

## Process changes and enforcement

| Waste source | Concrete change | Evidence that the change is being followed |
| --- | --- | --- |
| Repeated independent reviews | One implementation owner; self-review checklist; one final combined reviewer | No reviewer dispatch between R00 and R08 |
| Full suites after small edits | Gate tiers below; broad checks on a frozen candidate | Each run records why affected coverage requires it |
| Multiple diagnostic-only matrices | Hypothesis and complete evidence checklist before dispatch; focused platform/suite CI | A run has a stated decision it can resolve |
| Fragile fixtures and navigation | Bounded harness repair list, standalone test checks, exact visible targets | Failures are reproducible without earlier tests |
| Repeated large-context coordination | One current checkpoint, one task owner, short summaries | No copying full logs/histories into agent prompts |
| Moving finish line | Explicit blockers, residuals, and investigation limits | New findings enter a classified queue; no silent expansion |

Use one authoritative repair checkout and one app/native-test lane. Do not
create a coordinator plus another implementation worker. A fresh Sol/high
session with the short checkpoint is preferable if the existing session is
dominated by historical context; keep the old session idle and do not fork its
entire history. Starting a session is deferred until the user resumes.

Per-task cycle: `scope -> reproduce -> change -> self-review -> focused gate ->
commit/checkpoint -> next task`. A task can be LOCALLY_VERIFIED while the combined
candidate still awaits final acceptance. Do not describe that state as a hosted
Product pass or mark G02/G03 DONE prematurely.

Self-review must answer: Does the change explain the observed cause? Does the
regression fail before the fix? Are error/cancel/restart paths covered where
affected? Are source identity, data preservation and isolation intact? Did an
assertion/fixture/threshold change, and does it still prove the original behavior?
What existing evidence became stale? Are there unrelated changes in the diff?

## Verification schedule

The coherent repair candidate is the unit for full validation. Mandatory
AGENTS.md checks still run before final acceptance and any subsequently authorized
main push; they are not repeated after every intermediate edit or review comment.
R00 records this timing explicitly in project instructions without staging user
hunks. If a task must be independently accepted before the batch, run its required
broader gate then and reuse that exact evidence later where applicable.

| Event / change | Run now | Defer until the frozen candidate |
| --- | --- | --- |
| Reproduce one issue | Smallest failing unit or E2E case | Unrelated cases/platforms |
| Iterate a fix | Regression plus directly affected adjacent cases; self-review | Full Product, external reviewers |
| Pure main/shared utility task closes | Targeted tests; required product-unit suite once per coherent main/shared change set | GUI suite unless affected |
| Renderer/app/IPC change | Build if output is stale, then affected E2E/units under correct runtime | Full Product and full OS matrix |
| Fixture/helper change | Consumer tests and relevant helper tests; demonstrate standalone execution | Unrelated product cases |
| Workflow change | Repo contract RED/GREEN, relevant Repo checks; focused sandbox job validates actual workflow | All-platform Product/packaging unless changed or at final gate |
| Documentation only | Link/status/diff checks and relevant docs tests | Build/Product/CI |
| Platform-only unknown | One selected platform with a finite set of affected tests and failure evidence | Other platforms and packaging |
| R07 frozen integration candidate | Build once; full Product locally; one full platform matrix | Nothing required for acceptance |
| Final review repair | Affected regression/gates; rerun full gate if relevant source/test/config changed | Unchanged evidence is reusable, not an automatic rerun |
| Mechanical local integration | Compare relevant source/test/config tree and fixture/runtime tuple | No duplicate suite solely for a different commit SHA |

Commands already present:

- Build: `npm run build` (includes typecheck; do not immediately duplicate it).
- Unit suite: `npm run test:product:unit` with the Node native dependency ready.
- Focused Node tests: `node scripts/run-node-tests.mjs <exact test paths>`.
- Focused E2E: `npx playwright test <exact file> --grep '<exact title pattern>'`,
  after a current build/fixtures and Electron native preparation. This command
  does not itself guarantee those prerequisites.
- Full gate: `PYTHON=/usr/bin/python3 npm run test:product` on this macOS host.
  Preserve **Node native rebuild -> units -> Electron native rebuild -> E2E**.
  Do not insert Node SQLite tests after the Electron rebuild before E2E.
- Repo checks: `npm run test:repo`; distinguish the documented ignored scratch
  convention failure from new failures. Do not delete user/task evidence to get green.

Focused CI selection is **not currently available** in the Build workflow.
R03 must add and verify it before the plan relies on it. Use enumerated platform
and suite choices, not arbitrary command strings or user-supplied shell fragments.
Default existing full Build behavior remains unchanged; focused jobs do not package
or publish. No new remote Codex hosts are needed.

## Test/harness work: known repairs versus investigations

Already fixed on the isolated branch: native path fixture mismatch, slicer and
restore per-test setup, bounded main-window discovery, Linux window-manager setup,
failure artifacts, correct virtualized target navigation, and exact-process cleanup.
These must be retained and checked for coverage gaps, not reimplemented wholesale.

Required remaining work:

- Finish the preserved thumbnail-refresh wait: observe the new authoritative
  path before reading it; retain bytes/color/size/revision assertions.
- Finish the visible-anchor test: use a mostly visible exact key, record geometry,
  retain scroll/selection semantics. The proposed two-pixel tolerance addresses
  observed one-pixel rounding; it must not hide a changed row or lost visible position.
- Confirm the shared main-window and independent-fixture fixes cover affected
  consumers. Run recovery tests by exact title alone. No test may depend on a
  previous test creating its backup, selecting its slicer or restoring its state.
- Keep captured traces, screenshot/DOM state, app errors, job/revision state and
  process identity on failure. Diagnostic I/O must never prevent cleanup or replace
  the original assertion error. Do not grow a general telemetry subsystem.
- Test launches must set explicit private Chromium profile/userData and private
  database/library paths from process start. HOME or ELECTRON_USER_DATA alone is
  insufficient on macOS. No repeat of the unflagged real-profile incident.
- Make exact target navigation and async operation completion deterministic.
  Do not disable virtualization, force-click an absent target, or convert an
  application error into a retry-until-green gate.

Bounded analysis, not assumed fixes:

- Embedded builds exist in `app.e2e.ts` and `viewer-idle.e2e.ts`. R04 evaluates
  removing those duplicates in favor of one orchestration owner, while preserving
  standalone test entrypoints and fresh output. Skip the refactor if it requires
  broad runner changes; document the remaining overhead instead.
- Separate deadlines for startup, a controlled operation, full workload drain,
  and cleanup. A five-second scan-drain timeout is not the one-second first-visible
  contract. Require progress/error evidence for any revised completion deadline.
- Separate reference performance measurements from hosted-runner results. C10's
  reference budgets remain unchanged. No Windows 329 ms gap becomes a pass merely
  by relabeling it: document the environment and obtain an explicit acceptance
  decision if a different hosted timing gate is proposed. CI calibration is a
  finite analysis task, not permission to tune until green.

## Concrete remaining product scope

1. **Small-window preview:** finish the preserved CSS repair for a zero-height
   viewer at 900x600. Verify >=160px stage height for the affected layout, usable
   preview, reachable footer controls through scrolling, both themes, and no
   regression at 1280x800/1920x1080. Do not redesign the panel.
2. **Windows scan responsiveness:** explain and address the synchronous database
   work correlated with the latest 315ms metadata span/329ms heartbeat gap. First
   distinguish transaction work, scope updates, notification work, checkpoint and
   I/O costs using existing timing evidence. Do not accept the dirty 128-page WAL
   setting without evidence of both responsiveness benefit and acceptable total
   throughput. Do not relax SQLite durability, bypass transactions or alter schema
   merely to improve a test. A failed hypothesis is removed from the candidate
   only after its patch is safely preserved.
3. **Residual failures:** classify fresh failures once. Windows metadata retry,
   watcher and intermittent anchor/thumbnail cases are not assumed current product
   defects simply because a historical run failed. Carry exact reproductions and
   current-source evidence forward; keep genuine unresolved findings visible.

Do not reopen the verified Linux lifecycle/file-access/thumbnail-publication
repairs without a concrete new regression. Preserve their guard tests and disclosed
limits, including PID-reuse TOCTOU and parent-directory replacement races.

## Run budget and stop conditions

These are proposed control limits for the restart, not promises of token cost:

- One task/issue at a time; no repeated full history inspection.
- Before a diagnostic run, record hypothesis, distinguishing observations,
  acceptance criteria and the next action for each possible outcome.
- Spend at most 45 minutes of active investigation on one unresolved hypothesis
  before checkpointing/reassessing. Do not spend the time budget in polling.
- At most two focused remote diagnostic attempts for one hypothesis. A second
  attempt must collect missing decisive evidence or verify a concrete correction.
  No new evidence means stop that line of inquiry, not launch a larger matrix.
- Target one full matrix for the frozen candidate. A failed gate can require
  another, but only after a classified cause and reviewed self-check; recheck the
  affected platform first. Record every extra full run's reason.
- At budget exhaustion, continue another independent bounded task if useful;
  otherwise pause and present the actual choice (defer, change scope/acceptance,
  or fund more investigation). Do not ask routine continuation questions.
- Automation stays paused now. If later re-enabled, one compact hourly status
  check; no duplicate reviews/runs and no repeated unchanged-blocker notices.

## Evidence and final acceptance

Keep one current checkpoint in the restart tracker: owner, task, checkout/SHA,
dirty-file disposition, next action and blocker. Keep detailed raw evidence in
scratch; use a single consolidated final report with links to prior evidence.

For each verification record: issue/task, exact source/test/config snapshot,
command, platform/runtime/native state, fixture identity, outcome, duration and
log/artifact path. Reuse evidence only when relevant inputs match. Record failed
attempts, investigation time, number of model review dispatches and broad CI runs;
these distinguish productive fixes from churn without inventing billed credits.

After all restart tasks pass their local gates, freeze the candidate, run final
validation, and dispatch **one** independent Sol/high reviewer. The reviewer
checks the changed high-risk code, error/recovery/cancellation paths, scope and
assertion changes, actual feature journeys and screenshot/UAT evidence. It returns
one severity-ranked list with concrete triggers and evidence, not cosmetic cleanup.
It does not independently rerun unchanged full suites or create another reviewer.
The worker owns repairs; re-review the affected delta only.

Completion requires the agreed functionality and tests on the same final tree,
no unresolved blocking reviewer findings, accurate docs, and a final limitations
list. Hosted screenshots plus agent visual inspection are evidence; do not claim
human Windows/Linux UAT. Remote manual setup stays deferred. Windows uninterrupted
live-root disappearance is currently unverified; restart-offline recovery is tested.
The historical non-reproduced 107ms multipart observation remains disclosed.
Optional raw Chromium listener census, aggregate backlog/decoded-memory census,
other GPU vendors and real base.3mf are not newly mandatory work.

G02/G03 remain open until their actual requirements are satisfied or the user
explicitly accepts a documented limitation. No publication or main push follows
automatically from a passing final review.
