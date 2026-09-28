# Sequential coordinator/worker execution policy

## User decision and current execution state

The user requested that parallel implementation stop. Luna remains the coordinator for selecting work and applying acceptance criteria; one Luna worker performs the selected task. Astra remains reserved for final integration review. This policy supersedes the concurrency and scheduling sections of the earlier Luna handoff; the task scope, contracts, and required verification gates remain in force.

**Execution resumed by the user on 2026-09-28.** The user confirmed that the feedback/access interruptions were addressed, selected Full access for the Luna coordinator, and requested continued autonomous execution. Follow the bounded autonomy rules below. Earlier pause instructions are historical and do not require another confirmation.

Historical 2026-09-27 pause checkpoint (not current task status; use the tracker):

- Primary checkout `/Users/maak/repos/polytray`: HEAD `4506751`, no merge/cherry-pick in progress, but unfinished Stage 4 source/wiring/test edits remain uncommitted.
- U02 worker `/Users/maak/.codex/worktrees/stage4-u02/polytray`: HEAD `8a8e03d`, clean, worker idle.
- T04 worker `/Users/maak/.codex/worktrees/stage4-t04/polytray`: HEAD `41a6cce`, clean, worker idle.
- Independent reviewer `01a0e1fe-a466-7810-9892-71009a512cc2`: idle.
- The latest full Product attempt, before final API narrowing, had 337 unit passes/1 skip and 46 E2E passes/1 optional skip **plus one reproducible library-pages E2E failure**. It was not a passing gate. The attempted pagination-wait adjustment did not resolve the failure. The subsequent thumbnail-only API narrowing is not yet reverified.
- Preserve the generated `tests/support/fixtures/test_bundle.zip` change until the next designated owner accounts for/restores that known artifact. Preserve all other in-flight changes and the pre-existing user edits listed in the handoff.
- Tracker remains 19/33 DONE; U02/T04 are candidates under review, not completed tasks.

## Bounded autonomy and permission handling

The objective is the complete remaining approved plan, not only the most recent repair. After a task, status answer, permission repair, or successful commit, update the checkpoint and continue to the next dependency-ready task. Do not end execution merely because one such step finished. Stop the overall run only on explicit user pause, readiness for final Astra review, or a genuine external constraint that prevents all useful authorized progress.

Already-authorized routine work includes:

- Implementing the approved task specifications and their necessary, acceptance-preserving regressions/fixes in this repository and assigned worktrees. Core modules are not excluded merely because they control lifecycle: for example, S05 explicitly includes watcher event ordering and lifecycle changes. This is authorization for the planned bounded implementation, not an unrelated redesign or permission to ignore an explicit denial.
- Reading/editing assigned source, tests and handoffs; ordinary engineering choices within C1-C10; independent Luna review; local Git metadata writes, commits, cherry-picks and merges; dependency/native rebuilds; isolated Electron/Playwright/local-socket tests; and cleanup of exact task-owned temporary artifacts/processes.
- Messaging/dispatching the authorized worker/reviewer tasks, selecting the next ready task, and continuing unaffected work when one task is blocked. Do not ask whether to continue unaffected work when this policy already permits it. Keep exactly one active implementation task/worker.

Each dispatch must restate the task's actual intended edits, owned paths, test scope and relevant authorization briefly. A reference to a task ID alone may not communicate the required scope to an approval reviewer. Retain the user-approved contracts and prior decisions; do not request approval again for the same resolved issue.

Distinguish three different situations:

1. **Ordinary sandbox denial:** `.git/index.lock`, external-worktree build output, FSEvents and TSX `listen EPERM` can be execution-boundary failures. Use the supported scoped escalation when the active permission mode permits it. Do not change source, loosen assertions, change filesystem ownership, or relocate a socket repeatedly without evidence. Moving a TSX socket to another temp directory does not establish permission to create sockets.
2. **Explicit automatic-review rejection:** preserve the exact action and reason. Never retry through another route or treat Full access as retroactively erasing that decision. Inspect the current user authorization and concrete risk, use the normal approval/override path where applicable, or establish a materially safer alternative. If a binding denial remains, park that task and continue an independent ready task; ask the user only for the unresolved action, not for general permission to continue the plan.
3. **Real external dependency:** unavailable credentials, usage/reviewer limits, unavailable platforms, or a genuinely new user-facing decision may still need the user. Report what is missing, its impact and the smallest decision needed. No permission setting guarantees those dependencies disappear.

The coordinator's latest inspected permission context was Full access (`danger-full-access`, approval policy `never`), selected by the user. Leave that setting unchanged unless the user changes it. Other existing workers/chats can have different permission contexts; inspect the actual context rather than assuming a coordinator setting automatically updates every old task.

If the user later selects **Approve for me**, eligible escalations go to automatic review while the sandbox remains in force. That mode can deny or interrupt work and cannot guarantee unattended completion. This policy does not override the reviewer, alter its policy, or change global permissions. See [official auto-review behavior](https://learn.chatgpt.com/docs/sandboxing/auto-review) and [permission modes](https://learn.chatgpt.com/docs/permission-modes).

Boundaries remain unchanged: preserve user edits and data; no real slicer/user-library test runs; no `origin/main` push without explicit permission; no release/site publication; no unrelated machine changes, credential access, or security-policy weakening. Independent reviews and required verification remain mandatory.

The previously authorized narrow scanner-hold repair has been completed; do not ask for it again. Task-specific test/fixture repairs necessary to prove an approved acceptance criterion remain part of that task. Broad test-harness or build-pipeline optimization remains deferred. If a new substantial harness project is necessary, preserve the failure and park/report it rather than silently widening scope or weakening the gate.

Immediate continuation: reconcile/commit only the coordinator-owned U04 evidence updates for accepted source `48d7b95`, without retesting unchanged source for prose. Then reassess S05's preserved rejection against its approved specification and the user's latest authorization. If it still cannot proceed through a permitted path, keep its block explicit and execute the next independent ready task, such as V04, rather than ending the overall run.

## One task, one owner, one candidate

1. **Exactly one active implementation task and one implementation worker.** Review, repair, integration, and validation are serial phases. Do not start another task while the current one is awaiting ordinary review or verification. A reviewer may run only while the implementation worker is idle.
2. **Coordinator responsibilities:** select a dependency-ready task, write its bounded brief, assign ownership, apply the acceptance criteria, record evidence/status, and authorize integration. It must not independently implement the same task or create parallel copies of the worker's tests/handoff.
3. **Worker responsibilities:** implement the whole assigned slice, including its tests and explicitly delegated adapters; run focused checks; commit a coherent candidate; hand it back. Existing cross-module ownership rules can be satisfied by explicit, narrow delegation from the coordinator to this single worker.
4. **One authoritative candidate checkout per task.** Reuse a suitable managed checkout, start from accepted local main, and keep all other checkouts idle. Preserve existing WIP rather than resetting/recreating it. The worker does not repeatedly synchronize from a moving main because main must not receive another task concurrently.
5. **No simultaneous coordinator/worker source edits.** The coordinator may maintain the task register. It may apply the reviewed candidate after the worker stops. A behavioral integration change goes back to the worker and through the applicable review; a mechanical conflict resolution must preserve both approved behaviors and receive appropriate validation.
6. **Freeze the interface before implementation.** The task brief names producer, consumer, payload/error semantics, revision/identity rules, and the adapter owner. Use the actual accepted API, not a future stub. If only thumbnail controls work, expose/document that supported boundary; S06 later supplies the generic scan/thumbnail dispatcher. A planned future consumer is an explicit obligation, not a reason to repeatedly rename a completed producer.
7. **A clean handoff precedes acceptance.** Record exact commit or working-tree snapshot, changed files, focused checks, required wider gate, remaining gaps and any owned process. Do not call a task DONE based solely on unit tests when its specification requires actual app behavior.
8. If a genuine external blocker prevents progress, document it and preserve the candidate before parking it. The coordinator may select another genuinely independent, dependency-ready task from accepted main, but only one task can be active. Do not use routine review waits to recreate parallel workstreams.
9. Do not re-open accepted tasks merely to align branch mechanics. A discovered regression must identify the violated acceptance criterion and receive a bounded repair. Future features should consume stable interfaces through their planned adapters.
10. Use short worker briefs and <=150-word completion reports. Keep detailed evidence in files. Independent specification and quality reviews remain required, but neither reviewer nor coordinator should routinely repeat unchanged tests or full source audits.

## Per-task lifecycle

`Select -> Implement -> Specification review -> Quality review -> Integrate -> Required verification -> Accept`

- The coordinator's brief includes: task ID, accepted base, owning checkout/files, dependency/interface contract, concrete positive/negative acceptance cases, required commands, and deferred scope.
- Implementation stops before review. Reviewers use an immutable checkpoint and return specific findings.
- Repairs go to the same worker; review the changed behavior and affected boundaries rather than restarting the entire audit.
- Integration uses reviewed commits, not file copying followed by duplicate cherry-picks. Worker-owned tests and handoff files are not separately authored on main beforehand.
- All required acceptance and verification evidence must exist before marking DONE and selecting the next dependent task. Existing tracker statuses remain the source of truth; record the current phase in its evidence/active-assignment note.

## Sequential queue (completed entries are skipped using the tracker)

First stabilize the **already interleaved U02/T04 candidate as one recovery checkpoint**, with one designated integration worker. This is a one-time preservation measure, not permission to start two new implementation tasks. Inventory the current main diff, separate task-owned edits from user edits, complete the reviewed thumbnail-only API boundary, and classify the reproducible library-pages failure before deciding the bounded repair. Do not discard either worker's completed work. Both IDs remain open until their own acceptance cases and the combined gate pass.

After that checkpoint, execute in this order, one task at a time:

| Order | Task | Dependency/ownership reason |
| --- | --- | --- |
| 1 | S04 measurements and units | Finish the metadata/result contract before later watcher and geometry consumers. |
| 2 | S05 watcher ordering | Consume accepted metadata and thumbnail services; stabilize writer ordering before controls/recovery. |
| 3 | S06 scan controls | Complete scan lifecycle and generic job dispatch after both job services are stable. |
| 4 | U04 keyboard/focus | Stabilize PreviewPanel/overlay interaction before later parts/workflow UI. |
| 5 | V04 background geometry preparation | Consume accepted S04/V03 contracts; verify preparation and thumbnail parity. |
| 6 | V05 progressive part images | Build on V04 without competing edits to viewer/PreviewPanel. |
| 7 | P04 recoverable restore | One serial persistence stream after scanner/watcher/job interfaces have settled; retain its schema/repository/journal/recovery checkpoints. |
| 8 | U05 background work UI | Consume complete job/control/recovery interfaces with one watcher-preference owner. |
| 9 | U06 workflow UI | Integrate the accepted slicer, backup/restore, measurement and focus services. |
| 10 | G01 integrated correctness | Freeze the product candidate and exercise combined behavior/platforms. |
| 11 | G02 performance/resource evidence | Measure the verified candidate against unchanged budgets. |
| 12 | G03 documentation preparation | Reconcile source, evidence and limitations; prepare the frozen review packet. |
| 13 | Astra final integration review | Luna handles any repairs and affected revalidation; no routine Astra dispatch. |

All original task specifications and C1-C10 acceptance contracts still apply. This ordering does not remove any remaining task or authorize origin/main pushes or publication.

## Build/test execution instructions: procedural savings only

This section addresses routine verification overhead without changing build scripts, test code, fixture implementations, or acceptance thresholds. AGENTS.md still determines which checks are mandatory.

| Situation | Execute | Avoid |
| --- | --- | --- |
| Small implementation iteration | The failing/relevant focused test; typecheck when it provides useful early feedback | A full Product run after every small edit |
| Build is due | `npm run build` once for the coherent source snapshot; it already runs typecheck | An unchanged standalone typecheck immediately followed by build as a ritual |
| Focused app regression | Fresh build if outputs are stale, correct Electron native dependency, then the affected E2E file/cases and relevant predecessor scenarios | Testing stale output, wrong native ABI, or repeating every unrelated app case to diagnose one failure |
| Unit gate required, Product not required | `npm run test:product:unit` once on the candidate; first restore the Node native dependency only if its state is wrong/unknown | Treating a small focused test as a substitute for the AGENTS-required unit gate |
| Final task/integration gate | The checks required by AGENTS and the task; use full `PYTHON=/usr/bin/python3 npm run test:product` when required | A separate unchanged full unit run immediately before Product solely for duplication; Product already includes it |
| Product failure | Preserve the log, identify phase/case/environment, diagnose using the smallest relevant reproduction, then rerun the broad gate after a justified correction | Repeated unchanged full runs hoping for green, blind timeout increases or skipped assertions |
| Documentation-only update | Link/ID checks and `git diff --check`, plus Repo checks when its specified triggers apply | Re-running Product solely for prose edits |
| Same candidate integrated without relevant changes | Reuse recorded evidence only after verifying source, tests, configuration, runtime/native setup and fixture conditions match | Repeating tests in both worker and coordinator checkouts merely because the commit ID changed |
| Conflict resolution or behavioral correction | Recheck the affected layers and the required final gate | Treating old pre-resolution evidence as proof of the new tree |

The full Product script already performs **Node native rebuild -> product units -> Electron native rebuild -> E2E/fixture generation**. Preserve that order. Do not run Node SQL units between the Electron rebuild and app testing. Record the active checkout's native state instead of blindly alternating rebuilds. Use the documented source-build fallback only when needed, and the normal scoped permission path for known filesystem/FSEvents requirements.

Choose one validation owner for the candidate. Workers, reviewer and coordinator must not independently launch duplicate suites. Record one validation tuple: candidate/source snapshot, command, runtime/native state, fixture/environment, exit result, and log path. Re-run when a relevant input changes or an unresolved failure requires it, not on every status transition.

Some duplicate builds are **inside** `app.e2e.ts` and `viewer-idle.e2e.ts`. Removing those requires code changes and is deferred. Do not invent unsupported skip-build flags or rely on test-file execution order to satisfy a required build. Existing timed observations for debounce/idle behavior are not automatically redundant.

## Explicitly deferred work

- Test-harness stability/refactoring, long-timeout redesign, watcher/hold fixture changes, and removing embedded per-file builds are deferred to a later reliability pass, as requested by the user.
- Do not expand this policy change into build/test-code work or performance profiling.
- The current reproducible library-pages failure is **unclassified**, not assumed flaky. On resume, distinguish a product regression (bounded in-scope repair) from a harness issue needing the deferred reliability work. If that diagnosis or required harness work becomes substantial, report the blocker rather than spending indefinitely or claiming the gate passed.
- A deferred required-test failure stays visible and blocks the corresponding completion claim. Deferral is not a waiver of correctness, Product, platform, or final review requirements.
- Preserve the existing no-push-to-origin/main rule and all user edits. Follow the current execution state above; a historical pause does not override the user's later resume.
