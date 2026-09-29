# Luna coordination plan for the remaining performance/UX work

## Authority, scope, and immediate state

The user requested a new **GPT-6 Luna coordinator**, retaining the existing Astra chat for the **final integration review**. The new coordinator chat is `01a0e49e-6109-77d0-9035-574d005c8bd2` on host `local`. The newer [sequential execution policy](2026-09-27-sequential-execution-policy.md) supersedes this document's previous concurrency/scheduling instructions. Product scope and acceptance criteria remain unchanged.

- Coordinator and implementation/review workers: `gpt-6-luna`, medium reasoning. Do not silently upgrade or wake Astra for routine work.
- **Execution is active under the user's 2026-09-28 resume and bounded-autonomy instructions.** Continue the approved sequential plan after routine checkpoints. Historical pauses do not require reconfirmation; the tracker is the sole source of current task status.
- Existing authorization permits isolated worktrees, task commits, and integration into local main. **Do not push to origin/main without explicit user permission.** No release or website publication is authorized.
- Follow `AGENTS.md`, `DEV_CONTEXT.md`, and the existing [33-task tracker](2026-09-26-performance-ux/tracker.md). Original task specifications and [C1-C10 contracts](2026-09-26-performance-ux/contracts.md) remain authoritative. A producer's DONE does not imply its later UI consumer is finished.
- Read live completion counts and blockers from the tracker. U02/T04, S04 and U04 have since passed their gates; do not restart their earlier checkpoints because this handoff contains historical evidence.
- Verify HEAD/status before further integration. The tracker records the latest accepted source and verification; the stage results below are historical evidence, not the latest gate.
- Stage 1 gate passed on 2026-09-27: `npm run build` PASS; full `PYTHON=/usr/bin/python3 npm run test:product` PASS (257 unit passes/1 Windows-only skip; 40 E2E passes/1 optional real-model skip). The S02 held-subtree metrics were 5.1 ms to first query and 35.21 ms maximum main heartbeat gap; V03 stopped the obsolete renderer in 73 ms. The E2E mutation-event assertion was corrected for the documented notification coalescing contract and independently reviewed.
- Stage 2 gate passed on 2026-09-27: `npm run build` PASS; full Product PASS (296 unit passes/1 Windows-only skip; 42 E2E passes/1 optional real-model skip). Metadata-worker heartbeat E2E, thumbnail invalidation E2E, scan-streaming metrics (5.6 ms first query/35.17 ms maximum heartbeat gap), and V03 cancellation (72 ms) passed.
- Stage 3 gate passed on 2026-09-27: `npm run build` PASS; full `PYTHON=/usr/bin/python3 npm run test:product` PASS (325 unit passes/1 Windows-only skip; 44 E2E passes/1 optional real-model skip). U01's 600-record/archive/thumbnail journey and V02's preview identity, retry, bad-member navigation, and archive paging passed. The generated ZIP fixture was restored to baseline.
- Focused evidence already obtained: S02 first queryable batch **5.9 ms** before held-subtree release, main heartbeat max **35.16 ms**; V03 obsolete renderer stopped **73 ms**, with distinct PIDs, A/B rejected, C successful, independent thumbnail work, fallback and cleanup assertions.
- The shared empty-ZIP stream bug that interrupted the last two full Product runs was corrected in `f07baf7` and `6e3da0e`, independently reviewed, and merged. Do not diagnose it from an older checkout again.

Graph tools were unavailable in the prior work; check availability once and use exact-source fallback when unavailable. Never claim graph generation/coverage that was not verified.

Read only this handoff and the current task's specification initially. Do not reload old conversation transcripts, raw token-accounting files, or every source module into the coordinator context.

## Operating model and execution queue

Follow the [sequential coordinator/worker policy](2026-09-27-sequential-execution-policy.md): one active task, one implementation worker, one authoritative candidate. Implementation, independent reviews, integration and verification are serial phases. The coordinator selects the next ready task and applies acceptance criteria; it does not create a second implementation or duplicate worker-owned tests/handoffs on main.

Skip tasks already DONE in the tracker. The sequential dependency order is: S04, S05, S06, U04, V04, V05, P04, U05, U06, G01, G02, G03 preparation, and final Astra review. Preserve all existing WIP; do not restart finished work. The new policy contains the limited build/test execution instructions and the explicitly deferred reliability/code changes.

### Current coordinator checkpoint (2026-09-29)

S06 is DONE on local `main` at `e0cb46a` with `2a917ee` recording tracker acceptance. The service and integration bridge passed serial spec/quality review; Build and full Product passed (448 units/1 Windows-only skip; 55 E2Es/1 optional skip). Both scan-controls E2Es passed. The generated fixture ZIP is restored to baseline SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`.

U05 is DONE at integrated main `e253c1d`. Serial spec/quality reviews passed. `npm run build` and full Product passed: 460 unit passes/1 Windows-only skip; 56 E2E passes/1 optional skip. Fixture ZIP was restored to SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`. U06 is the next task. Follow the current tracker/task specification, assign one Luna/medium worker, use the reused checkout from current main, then continue G01 -> G02 -> G03 preparation and final Astra packet. No push/release/publication or real user data; preserve unrelated primary-checkout edits.

## Task reference and acceptance map

The tracker is authoritative for current completion status; this reference includes previously completed producers. Use the linked full specification for owned files, individual steps, and tests. The checks below highlight the remaining integration risks rather than replace those specifications.

| ID | Specification | Remaining concrete completion check |
| --- | --- | --- |
| S02 | [Scanning](2026-09-26-performance-ux/scanning.md#s02---stream-discovery-and-commit-useful-batches-early) | Re-run the combined gate; preserve first-batch/barrier proof, bounded queues, revision/ABA fences and closed/error-settled ZIP streams. |
| V03 | [Preview](2026-09-26-performance-ux/preview.md#v03---cancel-obsolete-parsing-through-an-owned-preview-runtime) | Re-run the combined gate. Geometry remains renderer-to-renderer over transferred ports; main receives control/settlement only. Keep PID guards, <=500 ms old-parser stop and lifecycle cleanup. |
| T02 | [Thumbnails](2026-09-26-performance-ux/thumbnails.md#t02---make-refresh-clear-and-cache-version-reset-authoritative) | Finish one all/folder/file invalidation service, startup reconciliation and existing adapters. Prove old manual callers cannot restore a captured thumbnail path after invalidation even when content revision is unchanged. |
| S03 | [Scanning](2026-09-26-performance-ux/scanning.md#s03---move-metadata-cpu-work-out-of-the-main-process) | Finish owned utility-process lifecycle, bounded requests, streamed STL/OBJ, archive-stream ownership, revision-safe commits, cancellation/crash retry and real main-heartbeat evidence. |
| U01 | [Browsing](2026-09-26-performance-ux/browsing.md#u01---load-every-result-and-keep-selection-consistent-across-pages) | **DONE:** reviewed async query guards, 600-record/archive paging, selection/deletion, and T02 thumbnail consumer; Stage 3 Product PASS. See [U01 handoff](2026-09-26-performance-ux/handoffs/U01.md). |
| V02 | [Preview](2026-09-26-performance-ux/preview.md#v02---decouple-metadata-from-geometry-and-show-durable-preview-states) | **DONE:** reviewed identity/retry/archive state, integrated `PreviewTarget` and revision-bearing T02/T01 events, and Stage 3 Product PASS. See [V02 handoff](2026-09-26-performance-ux/handoffs/V02.md). |
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
| U01 | `/Users/maak/.codex/worktrees/polytray-layout/polytray`, `codex/perf-u01` | DONE at `eed5856`; integrated to local main and Product-verified; checkout preserved | `01a0e202-8608-7f21-a52d-5e89ef92806b` |
| V02 | `/Users/maak/.codex/worktrees/polytray-import/polytray`, `codex/perf-v02` | Source DONE at `fbed369`; V02-owned commits integrated; unrelated partial merge left preserved and uncommitted | `01a0e202-0863-7f30-bfb8-c159d2e58053` |
| U02 | `/Users/maak/.codex/worktrees/stage4-u02/polytray`, detached at `12ba102` | IN_PROGRESS: search state/targeted refresh; private npm dependencies installed | `/root/u02_search_refresh` |
| T04 | `/Users/maak/.codex/worktrees/stage4-t04/polytray`, detached at `12ba102` | IN_PROGRESS: thumbnail controls/accounting; private npm dependencies installed | `/root/t04_thumbnail_controls` |
| T02 | `/Users/maak/.codex/worktrees/polytray-thumbnails/polytray`, `codex/perf-t02` | DONE at `3134282`; clean; producer service and bounded event contract integrated locally; U01 owns the cache-event consumer | `01a0e201-7438-7391-9843-ac3d21ed3c67` |
| S03 | `/Users/maak/.codex/worktrees/polytray-foundation/polytray`, `codex/perf-s03` | DONE at `55b21c0`; worker/source tests clean; shared build/startup/IPC wiring integrated locally as `ca263f8` | `01a0e293-6dd9-74d0-b51b-a11a33697713` |
| Later P04 | `/Users/maak/.codex/worktrees/polytray-slicer/polytray`, `codex/perf-p01` | P01 completed, clean at last checkpoint; recheck before reuse | `01a0e204-6183-7ee2-a2ac-0bbd43568fa3` |
| Independent review | Read-only candidate commits | Reviewer has no implementation ownership | `01a0e1fe-a466-7810-9892-71009a512cc2` |

S02's preserved checkout is `/Users/maak/.codex/worktrees/polytray-fixtures/polytray` at `6e3da0e`; V03's is `/Users/maak/.codex/worktrees/polytray-review/polytray` at `d742041`. Their internal subagents belong to the old coordinator tree; the new coordinator should rely on committed source/handoffs or assign a fresh Luna reviewer instead of assuming those agent names are addressable.

Do not merge the superseded drafts in worktrees `61df` (`74d2e9e`), `1221` (`3a3b13c`), or `861a` (`b9701b5`). They are preserved alternatives, not active assignments.

### V02 approval constraint

Automatic review declined the worker's manual `src/main/index.ts` merge resolution with this stated reason: **"This introduces unrelated slicer process startup-cleanup and lifecycle changes into the V02 merge, with possible service disruption and no trusted authorization for that side effect."** The rejection explicitly prohibited bypassing it through another route and allowed checks establishing authorization/low risk before retrying.

Do not blindly abort/reset the partial merge, repeat the rejected edit, or work around the review. The coordinator inspected and preserved the owned changes, then used the normal reviewed repository-write path to select current main's lifecycle wiring for `src/main/index.ts`; that bounded resolution was accepted. V02 integration was completed by applying only its preview-owned commits on current main and resolving the `PreviewPanel` conflict while preserving the current V03 viewer-session lifecycle. The broad partial merge remains preserved in the V02 worktree and was not committed. A passing typecheck on that partial merge was not treated as evidence of a completed integration.

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
