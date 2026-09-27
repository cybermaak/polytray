# Integration, performance, and readiness tasks

Read the [plan](../2026-09-26-performance-ux-execution-plan.md), [contracts C10](contracts.md), and [tracker](tracker.md). G validates the integrated implementation. It does not mark producer tasks done on the strength of their descriptions alone.

## G01 - Prove integrated correctness and recovery

**Priority:** release readiness. **Dependencies:** U05, U06, V05. **Owner:** coordinator/validation owner.

**Own:** new `tests/product/e2e/integrated-library.e2e.ts`, cross-stream regression tests, and coordinated fixes to common fixture/launch helpers. Implementation fixes go back to the owning stream; do not rewrite multiple subsystems in this test task.

**Steps:**

1. Verify every dependency's handoff has actual passing commands and consumer wiring. Check no success stub, temporary feature bypass, test-only allowlist relaxation, or production test hook remains enabled.
2. Run one isolated end-to-end journey combining 600+ mixed records, a large archive, a collection member beyond the first page, sorting/searching, page navigation, tagging, comparison, and preview. Confirm the same items/counts before and after metadata changes.
3. Run concurrent scan/watch/thumbnail/preview activity with rapid scope changes. Disconnect/reconnect a root, inject an unreadable subtree/corrupt archive, cancel and retry jobs, clear thumbnails while work is active, and restart. Confirm annotations and latest content identities survive.
4. Exercise keyboard/narrow-window/error journeys and archive slicer handoff with a mocked launcher. Export/import >500 annotated records plus pending/unmatched records and conflicts, then inject restore failures/restarts at each journal boundary.
5. Check canonical path/protocol regression tests, including sibling and symlink-escape cases for any touched read/extraction path. Keep the existing indexed-file allowlist; no blanket read permission is an acceptable fix for watcher thumbnails or slicer extraction.
6. Run Type, Build, and Product on the final integrated checkout. Record exact revision, native runtime sequence, fixture paths, and failures. Use the existing supported-platform test mechanism when available; do not edit or push Actions workflows as part of this plan without an explicit separate need/instruction.

**Acceptance:** All audit reproductions have durable regression coverage and pass together, not only in isolated branches. There is no annotation loss, stale result publication, missing page, blank thumbnail conversion, or hidden error. Metadata recovery works under injected interruption. Report any platform not yet exercised.

**Evidence:** A cross-stream coverage matrix linking each finding to a passing test, test logs, and selected window/failure-state captures. Store a concise report at new `docs/performance/performance-ux-validation.md`; large traces stay in task artifacts/scratch with references.

## G02 - Verify performance and resource budgets

**Priority:** release readiness. **Dependencies:** G01. **Owner:** coordinator/validation owner.

**Own:** new `tests/product/e2e/performance-regressions.e2e.ts`, `tests/dev/performance-baseline.ts`, probe helper improvements, and the performance validation report. Coordinator handles package scripts only if a dedicated repeatable performance command is needed.

**Steps:**

1. Repeat the F02 reference measurements on the integrated result using the same fixture shapes and recorded runtime/hardware. Run queries with five warmups and >=20 samples, record median/p95, count/grouping time, plans, and main heartbeat gaps.
2. Measure first committed/visible scan batch and queue bounds, metadata extraction responsiveness, thumbnail cache hit/miss/refresh, and progress event rate. Include many directories and a large collection, not only one flat library. Check the temporary membership/scope indexes do not create startup-sized stalls.
3. Measure settled render frames, minimize/restore, rapid preview cancellation, dense single-mesh assembly, and multipart first-frame-before-images. Record CPU long tasks and GPU upload separately. Check contexts, ports, listeners, worker processes, and image-cache bytes after at least 20 open/close/replace cycles; temporary peak memory is not itself a leak.
4. Compare against C10 and the audit baseline. If a target fails, identify the bottleneck, return a bounded follow-up to its owner, and rerun only affected evidence after the fix. Do not delete the test, change the fixture to an easier one, or silently relax the target.
5. Make deterministic behavior/resource invariants ordinary product gates: every page reachable, no idle frame loop, stale cancellation cannot publish, bounded queues/cache, early batch before delayed discovery completes, and no restore/scan data loss. Calibrate any wall-clock CI gate from repeated supported-runner measurements and document why it differs from the reference-machine target.
6. Keep portable dense/multipart fixtures mandatory. Run a real `base.3mf` only if available and explicitly record its size/source and optional status; absence is not a pass for that workload. Avoid adding remote telemetry or a new dependency just to collect local evidence.

**Acceptance:** Reference targets are met or explicitly remain open with an owner; all portable product invariants pass. Evidence shows the 50k folder path no longer causes the observed multi-second stall and idle previews no longer render continuously. No unsupported broad claim about all production models or every hardware configuration is made.

**Evidence:** Before/after table, command/environment/fixture details, numeric samples, resource cleanup results, and separate macOS/Windows/Linux coverage. If performance evidence is incomplete, leave this task in REVIEW/BLOCKED, not DONE.

## G03 - Reconcile documentation and hand back execution results

**Priority:** release readiness. **Dependencies:** G02. **Owner:** coordinator.

**Own:** `DEV_CONTEXT.md`, relevant README/product workflow docs, this plan/tracker, and the final validation report. Preserve all unrelated user documentation/marketing changes. No version bump/release notes asserting a publication that has not happened.

**Steps:**

1. Correct the architecture description to match the final implementation: actual database path, query/paging behavior, scope index, streaming/extraction ownership, dedicated preview runtime, render scheduling, thumbnail identity, settings ownership, and restore persistence.
2. Replace the historical render-on-demand claim with verified current behavior and date/evidence. Mark roadmap items complete only when their tasks and UI are actually done; link remaining limitations rather than hiding them.
3. Document user workflows for offline roots, job controls, archive preview/handoff, measurements/units, backup/import conflict policy, pending metadata, and recovery. Keep implementation detail out of normal product help unless it changes a user decision.
4. Update the test/run instructions only where commands actually changed. Preserve the Node -> unit -> Electron -> E2E native rebuild sequence and the existing pre-main-push gates. If repo/document contract tests apply, run Repo and distinguish pre-existing failures from introduced ones.
5. Review each task's evidence, assign final status, and list any still-unverified platforms or target misses. Final readiness requires supported-platform product evidence; if a platform cannot be run, keep its validation outstanding instead of asserting complete support.
6. Hand the user the implementation summary, measured improvements, residual issues, and tracker. Record verified task/integration commits. Do not push to origin/main, create a release, or change the website without later instructions.

**Acceptance:** Docs describe actual shipped-in-code behavior and its measured limits. All 33 task statuses match evidence; no open requirement is disguised as complete. The user has a concrete result to review before deciding publication or further work.

**Verify:** Link/ID/dependency consistency, `git diff --check`, relevant Repo checks, and final Build + Product evidence from the unchanged integrated implementation. Do not rerun expensive tests just for prose edits unless a changed command/contract warrants it.
