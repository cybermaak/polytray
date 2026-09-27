# Luna coordination plan for the remaining performance/UX work

## Authority, scope, and immediate state

The user requested a new **GPT-6 Luna coordinator**, retaining the existing Astra chat for the **final integration review**. The new coordinator chat is `01a0e49e-6109-77d0-9035-574d005c8bd2` on host `local`. This document changes execution order and coordination ownership, not the approved product scope or acceptance criteria.

- Coordinator and implementation/review workers: `gpt-6-luna`, medium reasoning. Do not silently upgrade or wake Astra for routine work.
- Implementation is paused. The new coordinator initially reads this handoff, verifies the checkpoint read-only, acknowledges readiness, and waits for the user's instruction to resume.
- Existing authorization permits isolated worktrees, task commits, and integration into local main. **Do not push to origin/main without explicit user permission.** No release or website publication is authorized.
- Follow `AGENTS.md`, `DEV_CONTEXT.md`, and the existing [33-task tracker](2026-09-26-performance-ux/tracker.md). Original task specifications and [C1-C10 contracts](2026-09-26-performance-ux/contracts.md) remain authoritative. A producer's DONE does not imply its later UI consumer is finished.
- **13 tasks are DONE; 20 remain.** S02/V03 are implemented and merged but await the combined Product gate. S03/T02/U01/V02 have preserved work in progress. Fourteen tasks are unstarted.
- Current product source checkpoint: `bf6cdfe` (S02 merge `3005977`, V03 merge `bf6cdfe`). Typecheck and Build passed on that combination. Subsequent commits may be documentation-only; verify HEAD before acting.
- Last fully green Product checkpoint before these final scanner/preview merges: **219 unit passes + 1 Windows-only skip; 38 E2E passes + 1 optional real-model skip**. This is not a pass for the newer combined source.
- Focused evidence already obtained: S02 first queryable batch **5.9 ms** before held-subtree release, main heartbeat max **35.16 ms**; V03 obsolete renderer stopped **73 ms**, with distinct PIDs, A/B rejected, C successful, independent thumbnail work, fallback and cleanup assertions.
- The shared empty-ZIP stream bug that interrupted the last two full Product runs was corrected in `f07baf7` and `6e3da0e`, independently reviewed, and merged. Do not diagnose it from an older checkout again.

Graph tools were unavailable in the prior work; check availability once and use exact-source fallback when unavailable. Never claim graph generation/coverage that was not verified.

Read only this handoff and the current task's specification initially. Do not reload old conversation transcripts, raw token-accounting files, or every source module into the coordinator context.

## Operating model

1. Use **at most two implementation workers concurrently**, plus one independent Luna reviewer when needed. Start with one worker for a task involving shared lifecycle or persistence boundaries. Maintain one GUI/Electron/performance-test lease across all chats.
2. Use separate worktrees for concurrent implementation. Reuse a suitable existing checkout after checking status and accounting for its work; preserve all dirty/partially merged checkouts. Do not recreate completed work or merge the superseded drafts listed below.
3. Workers own the modules in their task specification. The Luna coordinator now owns shared startup/IPC/preload/settings wiring, the tracker, merge decisions, and test-lease assignment. Delegate a narrow common-file edit explicitly; never let two workers edit the same shared file concurrently.
4. Resume the existing worker only to finish its current checkpoint. For a later task prefer a fresh bounded Luna worker context, supplying the exact task, base, owned paths, contracts, and prior handoff. The user authorized this ongoing worker-coordination workflow.
5. Freeze a cross-stream API in a small reviewed commit before implementing both sides. Integrate the producer once, then update consumers from that verified base. Do not repeatedly merge a moving main into every idle branch.
6. Keep implementation self-review, independent specification review, then independent code-quality review. Luna performs these gates. Return concrete defects to the owner; do not repeat an entire source audit when only a small reviewed correction changed.
7. Workers report commit, owned files, tests, unresolved items, and process/lease state in <=150 words; detailed evidence belongs in the task handoff file. Use `wait_threads` with cursors and bounded waits; do not repeatedly read unchanged histories or logs.
8. Run focused tests during implementation. Run the required affected-layer Product/Build checks on a coherent candidate and reuse that evidence when the integrated source/test/config tree is identical. Any conflict resolution or subsequent code change requires appropriate revalidation. Never omit an AGENTS-required check to save credits.
9. At a stage boundary, update the tracker and a concise run-state note, and report progress. Do not create a second competing task-status system or make broad claims from static review alone.
10. No routine messages to the Astra chat. At the final gate, send one review request with the packet path and frozen commit, then wait for findings. The original Astra chat is `01a0e10d-a660-7090-b9ca-bcf0fe5f3a01`.

## Ordered execution queue

The order below deliberately postpones persistence recovery until scanner/watcher/job interfaces are stable. It reduces repeated shared-file merges. Each row requires its stated gate before dependent rows proceed.

| Stage | Task IDs | Assignment and allowed concurrency | Required exit |
| --- | --- | --- | --- |
| 0 | Takeover only | Luna coordinator, read-only. Inventory the four WIP checkouts and the V02 approval constraint. Keep all workers paused until user resumes. | Correct checkpoint/ownership/lease record; no lost edits or new implementation. |
| 1 | S02, V03 | One validation owner on the current combined source. No new feature work while establishing this baseline. | Type + Build + full Product pass with corrected ZIP cleanup; record new counts and runtime evidence, then mark both DONE. |
| 2 | T02, S03 | Two workers: thumbnail invalidation and metadata utility process. Coordinator serializes their narrow scan/startup wiring. | Both producer APIs reviewed; real renderer/utility-process tests and combined Product pass. T02 event consumer remains explicitly in stage 3. |
| 3 | U01, V02 | Two coordinated UI owners: App/grid versus PreviewPanel. Resolve the preserved merge safely first; exchange the existing PreviewTarget and T02 event contracts. | Joint paging/preview/thumbnail-arrival E2E and Product pass. All 600+ records and multi-page archives reachable; metadata edits preserve geometry/camera. |
| 4 | U02, T04 | Search/targeted refresh and thumbnail job controls can run concurrently in disjoint modules. | Search cannot revive after clear; warm summary request counts remain stable; thumbnail pause/cancel/retry and accounting pass. |
| 5 | S04, S05 | Measurement parser work and watcher ordering may run concurrently once S03 is stable. Freeze the metadata result/version contract first. | Correct source-build measurements, parser parity, watcher add/change/unlink/root-disconnect tests, and affected Product gate. |
| 6 | U04, S06 | Keyboard/focus UI and scan job controls can run concurrently; coordinator owns their shared job/overlay adapters. | Keyboard-only virtualized navigation and topmost Escape pass; pause acknowledgment/cancel/no-prune/retry invariants pass. |
| 7 | V04, P04 | Geometry preparation and restore backend may run concurrently. P04 is one serially checkpointed persistence stream; do not split its tightly coupled transaction logic among competing writers. | Dense geometry budgets/parity plus crash-safe restore producer and mutation barrier verified. P04 substeps below must be reviewed in order. |
| 8 | V05, U05 | Progressive part images and background-job UI may run concurrently. U owns CSS; V supplies a narrow part-strip style request. | First usable frame precedes part images; camera/resources stable; real job controls work and watch preference remains authoritative. |
| 9 | U06 | One UI/workflow owner on the integrated base. Backend owners answer narrow questions without editing UI concurrently. | Slicer, export/import-preview/apply/recovery, pending matching, honest dimensions, and focus behavior work end-to-end. |
| 10 | G01 -> G02 -> G03 preparation | One integration/validation lane. Fixes return to their owners. No unrelated features. | Integrated correctness, supported-platform evidence, reference performance/resource report, and reconciled docs. G03 remains REVIEW pending Astra's final assessment. |
| 11 | Final Astra review | Frozen candidate plus review packet. Wake the original Astra chat once; Luna handles any requested repairs. | Final findings resolved and affected evidence refreshed; only then finalize G03/overall readiness. No publication. |

## What each remaining task must deliver

Use the linked full specification for owned files, individual steps, and tests. The checks below highlight the remaining integration risks rather than replace those specifications.

| ID | Specification | Remaining concrete completion check |
| --- | --- | --- |
| S02 | [Scanning](2026-09-26-performance-ux/scanning.md#s02---stream-discovery-and-commit-useful-batches-early) | Re-run the combined gate; preserve first-batch/barrier proof, bounded queues, revision/ABA fences and closed/error-settled ZIP streams. |
| V03 | [Preview](2026-09-26-performance-ux/preview.md#v03---cancel-obsolete-parsing-through-an-owned-preview-runtime) | Re-run the combined gate. Geometry remains renderer-to-renderer over transferred ports; main receives control/settlement only. Keep PID guards, <=500 ms old-parser stop and lifecycle cleanup. |
| T02 | [Thumbnails](2026-09-26-performance-ux/thumbnails.md#t02---make-refresh-clear-and-cache-version-reset-authoritative) | Finish one all/folder/file invalidation service, startup reconciliation and existing adapters. Prove old manual callers cannot restore a captured thumbnail path after invalidation even when content revision is unchanged. |
| S03 | [Scanning](2026-09-26-performance-ux/scanning.md#s03---move-metadata-cpu-work-out-of-the-main-process) | Finish owned utility-process lifecycle, bounded requests, streamed STL/OBJ, archive-stream ownership, revision-safe commits, cancellation/crash retry and real main-heartbeat evidence. |
| U01 | [Browsing](2026-09-26-performance-ux/browsing.md#u01---load-every-result-and-keep-selection-consistent-across-pages) | Review actual async request orchestration, not only reducer tests: immutable query snapshot and generation/disable/unmount checks after awaits. Complete paging, selection, shared images and accurate totals. |
| V02 | [Preview](2026-09-26-performance-ux/preview.md#v02---decouple-metadata-from-geometry-and-show-durable-preview-states) | Finish safe merge, review cache invalidation and thumbnail revision fencing, then actual state/camera/error/retry/archive E2E on the U01 integration. |
| U02 | [Browsing](2026-09-26-performance-ux/browsing.md#u02---unify-search-state-and-refresh-only-what-changed) | One search owner; cancel pending debounce on clear/reset/unmount; list/stats/tree refresh separately; verify request counts and stale response rejection. |
| T04 | [Thumbnails](2026-09-26-performance-ux/thumbnails.md#t04---centralize-thumbnail-queue-state-controls-and-retry-accounting) | One scheduler; priority and same-key dedupe; bounded retry; pause/resume/cancel; separate success/failure/cancellation counts; typed job adapters. |
| S04 | [Scanning](2026-09-26-performance-ux/scanning.md#s04---correct-dimensions-units-and-measurement-provenance) | Share the conservative DOM-free 3MF core; apply build transforms/units once; version measurements; repair legacy values without thumbnail invalidation; explicit unavailable/model-unit states. |
| S05 | [Scanning](2026-09-26-performance-ux/scanning.md#s05---index-watcher-changes-before-thumbnail-work-and-preserve-ordering) | Index/allowlist before enrichment; coalesce/order same-path events; reject late writes; preserve offline-root annotations; real watcher churn/reconnect tests. |
| U04 | [Browsing](2026-09-26-performance-ux/browsing.md#u04---support-keyboard-navigation-and-predictable-focus) | Stable-key virtualized roving focus, selection/navigation, accessible controls, topmost overlay Escape/focus restoration and coalesced announcements. |
| S06 | [Scanning](2026-09-26-performance-ux/scanning.md#s06---add-explicit-scan-job-pause-cancellation-and-targeted-retry) | Explicit valid job transitions, pause at bounded boundaries, cancel without prune, scoped retry, idempotent terminal events and bounded history. |
| V04 | [Preview](2026-09-26-performance-ux/preview.md#v04---prepare-orientation-in-the-background-and-budget-visible-mesh-assembly) | Move orientation/normals off visible thread; time/vertex-budget assembly, including one huge mesh; transferable ownership; cancellation and thumbnail/preview parity. |
| P04 | [Product](2026-09-26-performance-ux/product.md#p04---apply-restores-with-crash-recovery-across-both-stores) | Implement the staged persistence/recovery checkpoints below; no half-applied state, lost pending annotations, invented path mapping or SQLite transaction spanning IPC awaits. |
| V05 | [Preview](2026-09-26-performance-ux/preview.md#v05---make-part-thumbnails-small-progressive-and-independent) | First usable frame before images, separate small render target, visible/near-visible queue, <=64-image cache, token cancellation and resource cleanup. |
| U05 | [Browsing](2026-09-26-performance-ux/browsing.md#u05---present-useful-progress-and-respect-watcher-preferences) | Honest discovery/index/enrichment/thumbnail states, useful controls/errors, progressive rows, preserved browse position and one preference-driven watcher owner. |
| U06 | [Browsing](2026-09-26-performance-ux/browsing.md#u06---integrate-slicer-backuprestore-and-honest-measurements) | Explicit user activation for slicer/apply, complete snapshot revision binding, renderer recovery before automatic mutations, pending/conflict presentation and consistent measurement labels. |
| G01 | [Validation](2026-09-26-performance-ux/validation.md#g01---prove-integrated-correctness-and-recovery) | One mixed 600+ record journey, races/recovery/keyboard/narrow layout, path containment and supported-platform Product evidence. |
| G02 | [Validation](2026-09-26-performance-ux/validation.md#g02---verify-performance-and-resource-budgets) | Repeat C10 reference queries, first batches, CPU/idle/cancel/part-image budgets and >=20 resource cycles. Separate local reference timing from CI calibration; never relax targets silently. |
| G03 | [Validation](2026-09-26-performance-ux/validation.md#g03---reconcile-documentation-and-hand-back-execution-results) | Accurate architecture/user workflows, task-to-evidence matrix, explicit platform gaps and final review packet. Preserve unrelated user documentation edits. |

## P04: serial persistence checkpoints

This is the largest unstarted task. Use one accountable owner with independent Luna reviews at these boundaries. The scratch design at `.agent-tmp/perf-ux-coordinator/p04-design.md` is useful background, not a current-source inventory; its references to an unmerged S02 are historical.

1. **Contract and schema checkpoint:** inspect current writers; define one async mutation admission gate around synchronous repository commits. Keep SQLite work synchronous and never hold a transaction across renderer awaits. Specify plan ownership, bounded admission, renderer revision lock/CAS, journal schema, durable transaction marker and unresolved-conflict storage. Append migration 6 only; review before implementing the transaction service.
2. **Repository checkpoint:** apply indexed annotation changes, pending upserts/consumption and the database-applied marker atomically. Pending-only mutations also advance `browseRevision`, once per transaction, with annotation flags and no stats/topology changes. Reuse one canonical identity helper: fold Windows physical identity, preserve ZIP member case/dot spelling, resolve indexed writes to real stored IDs/paths. Preserve unrelated pending rows and nonblank note text.
3. **Journal/barrier checkpoint:** write a pre-import recovery backup and durable before/after journal before live mutation. Acquire the short barrier, recheck DB and renderer revisions, commit once, then stage renderer state and await acknowledgment without SQLite locks. Completed transaction IDs remain durable for v1; conflicting reuse of an ID is rejected. Define a bounded timeout/fail-closed path rather than retain watcher closures indefinitely.
4. **Recovery/matching checkpoint:** no DB marker means abort prepared work; a marker means roll forward to recorded after-state. Corrupt/unwritable recovery stays visibly unresolved. Preserve a durable record of already-watched scopes requiring reconciliation; imported roots must not trigger scanning merely by being restored. Successful pending matches are consumed transactionally, while conflicting incoming values remain durably reportable/exportable. Annotation-only events must not recursively retrigger matching.
5. **Producer integration checkpoint:** bind export to real pending storage and live renderer revisions. Expose prepare/apply/ack/status/retry-matching for U06. Test >500 records, each crash boundary, partial localStorage writes, missing acknowledgment, idempotent retries, Windows/UNC/opaque ZIP identities and queued watcher races. U06 later proves the actual UI journey.

Bound queue sizes and choose conflict/dirty-scope storage explicitly in the contract checkpoint; do not leave these as implementation guesses. Preserve S02's `ownedWrite` guard only around an admitted synchronous commit, never while waiting for gate admission. Keep the existing post-commit library publisher as the sole mutation notification path.

## Preserved checkouts and worker contacts

All listed chats are on host `local`. Prefer resuming the named worker for its existing WIP only. The coordinator may message these tasks under the user's ongoing coordination authorization; it need not ask again. Workers can report through their final message and handoff files; coordinator reads them through supported tools.

| Task | Worktree / branch | Paused checkpoint | Existing chat |
| --- | --- | --- | --- |
| U01 | `/Users/maak/.codex/worktrees/polytray-layout/polytray`, `codex/perf-u01` | `05690dc`; uncommitted `library-pages.e2e.ts` and `seedLibraryPages.ts`; no merge | `01a0e202-8608-7f21-a52d-5e89ef92806b` |
| V02 | `/Users/maak/.codex/worktrees/polytray-import/polytray`, `codex/perf-v02` | `fbed369`; partially merged main; `src/main/index.ts` unmerged; staged main changes, extra unstaged runtimeValidation/types, untracked handoff | `01a0e202-0863-7f30-bfb8-c159d2e58053` |
| T02 | `/Users/maak/.codex/worktrees/polytray-thumbnails/polytray`, `codex/perf-t02` | `21814e5`; uncommitted cache lifecycle implementation/test; latest focused 8 tests passed | `01a0e201-7438-7391-9843-ac3d21ed3c67` |
| S03 | `/Users/maak/.codex/worktrees/polytray-foundation/polytray`, `codex/perf-s03` | `f07baf7`; uncommitted metadata parser/client/worker, scan integration, startup/build wiring and tests; parser/client tests + Type/Build passed; SQL tests need correct Node ABI | `01a0e293-6dd9-74d0-b51b-a11a33697713` |
| Later P04 | `/Users/maak/.codex/worktrees/polytray-slicer/polytray`, `codex/perf-p01` | P01 completed, clean at last checkpoint; recheck before reuse | `01a0e204-6183-7ee2-a2ac-0bbd43568fa3` |
| Independent review | Read-only candidate commits | Reviewer has no implementation ownership | `01a0e1fe-a466-7810-9892-71009a512cc2` |

S02's preserved checkout is `/Users/maak/.codex/worktrees/polytray-fixtures/polytray` at `6e3da0e`; V03's is `/Users/maak/.codex/worktrees/polytray-review/polytray` at `d742041`. Their internal subagents belong to the old coordinator tree; the new coordinator should rely on committed source/handoffs or assign a fresh Luna reviewer instead of assuming those agent names are addressable.

Do not merge the superseded drafts in worktrees `61df` (`74d2e9e`), `1221` (`3a3b13c`), or `861a` (`b9701b5`). They are preserved alternatives, not active assignments.

### V02 approval constraint

Automatic review declined the worker's manual `src/main/index.ts` merge resolution with this stated reason: **"This introduces unrelated slicer process startup-cleanup and lifecycle changes into the V02 merge, with possible service disruption and no trusted authorization for that side effect."** The rejection explicitly prohibited bypassing it through another route and allowed checks establishing authorization/low risk before retrying.

Do not blindly abort/reset the partial merge, repeat the rejected edit, or work around the review. Inventory and preserve its owned changes first. Relevant new evidence is that P01 startup lifecycle and V03 disposal were independently reviewed and are already integrated together in main `bf6cdfe`; the newly designated Luna coordinator has the user's explicit integration responsibility. Inspect that exact source and the saved conflict, then use the normal approval path for a bounded resolution with this evidence. If rejection still prevents a safe resolution, ask the user and explain the exact action/reason. Unaffected tasks can proceed. A passing typecheck on the partial merge did not establish a completed merge.

### User edits to preserve

Primary checkout has pre-existing edits in `AGENTS.md`, `DEV_CONTEXT.md`, `scripts/capture-readme-media.ts`, and untracked `docs/marketing-site-refresh.md`, `docs/marketing/`, `docs/superpowers/`. Do not stage, reset, overwrite or incorporate them into task commits. G03 must reconcile its own documentation changes without silently committing these edits. If necessary preserve a separate documentation patch/report rather than using an index-blob workaround that was previously rejected.

## Test and environment runbook

- Host: macOS arm64; current Node was 25.9.0 (ABI141), Electron34.5.8 embeds Node20.19.1 (ABI132). Verify locally instead of assuming a directory named node@24 is Node24.
- Use `PYTHON=/usr/bin/python3`; default Python3.14 broke the installed native rebuild toolchain.
- Worktrees have private dependency copies. Never share native `node_modules` by symlink. Node tests and Electron need different native builds.
- Build before app tests. The required normal gate is `PYTHON=/usr/bin/python3 npm run test:product`: Node native rebuild -> product units -> Electron rebuild -> E2E. Do not collapse it into a plain units+E2E chain.
- A private prebuilt SQLite addon was killed at construction despite successful install/signature checks. The verified repair was `PYTHON=/usr/bin/python3 node node_modules/@electron/rebuild/lib/cli.js --version 34.5.8 --force --only better-sqlite3 --build-from-source`. A full gate can use command-local `npm_config_build_from_source=true` with system Python; verify the rebuild log. Do not change package/OS security settings to work around this.
- Preflight with the exact private Electron executable under command-local `ELECTRON_RUN_AS_NODE=1`, opening a `better-sqlite3` in-memory DB. That flag must not leak into GUI launches. Do not run Node SQL units after the Electron rebuild and before E2E.
- All app tests use the shared `launchIsolatedApp` or `buildElectronLaunchArgs` plus `buildElectronLaunchEnv`. The helper's macOS-only `-ApplePersistenceIgnoreState YES` bypasses a measured Cocoa crash-restoration modal for that test launch; no persistent OS preference changes or saved-state deletion.
- Worktrees outside the normal writable root need scoped tool permission for builds/edits. A default-sandbox FSEvents denial surfaced as `EMFILE`; the identical scanner test passed with scoped escalation. Distinguish permission/native failures from product assertions before changing code.
- No real user library or real slicer in tests. Keep artifacts in `.agent-tmp`/isolated scratch. Record an exact owned PID before stopping a stuck test; never kill arbitrary Electron processes.
- Product fixture generation modifies tracked `tests/support/fixtures/test_bundle.zip`. Restore only that known generated artifact after checking status; its baseline SHA256 was `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`.
- The old App's eager data-URL conversion can generate thumbnail access-denied logs; U01 owns its removal. Do not broaden path allowlisting to mask it. Verify any true path-containment failure separately.

## Final review packet for Astra

Write `docs/performance/final-integration-review.md` on the frozen candidate. Include:

1. Exact candidate SHA/base, source/test/config changes since the last gate, user edits excluded, and complete commit/worktree disposition.
2. All 33 task IDs linked to concrete tests/evidence, with no producer-only claim presented as complete UI behavior.
3. Latest Type/Build/Product results, native rebuild sequence, macOS/Windows/Linux coverage and explicit unavailable platforms; no green claim from skipped required coverage.
4. C10 before/after measurements, fixture/hardware/runtime details, percentile samples, resource cleanup and any target misses.
5. High-risk review map: index/revision/ABA/pruning, shared mutation barrier and restore recovery, path/ZIP identity, thumbnail invalidation/publication, preview transfer/cancellation/resource ownership, paging/selection/focus.
6. Known limitations, approval blocks, deviations from this plan, and unresolved findings. Attach selected UI captures and link large logs rather than pasting them.
7. A brief final-review request to Astra, with no request to redo routine dispatch or re-read entire worker histories.

Astra reviews the coherent final result. Luna performs fixes and reruns affected gates; if source changes after review, supply the focused diff and renewed evidence. Mark final readiness only when the required gates and final findings are resolved. Do not publish or push main as part of that signoff.
