# Polytray Development Context

**Important Context for AI Assistants:**
If you are an AI assistant reading this file at the start of a session, use it to understand the current architecture, recent progress, and immediate next steps for the Polytray project.

## 🛠 Maintenance Instructions for AI Assistants

1. **Always read this file** when continuing work on Polytray.
2. **Update this file** whenever a major milestone is reached, the architecture changes significantly, or new features are planned/completed.
3. **Move completed items** from the "Next Features Roadmap" to the "Completed Features" section.
4. **Preserve technical decisions** in the architecture section so future assistants understand _why_ things were built a certain way (e.g., using Web Workers for thumbnails, SQLite structure).

---

## 🏗 Architecture & Stack

- **Frameworks:** Electron 34, React 19, Vite.
- **Languages:** TypeScript (Strict Mode).
- **Core 3D Engine:** Three.js (v170). Handles parsing (STL, OBJ, 3MF) and rendering.
- **Database:** `better-sqlite3`. Stores file metadata and model metrics in `~/.config/polytray/library.db`.
- **Thumbnail Cache Storage:** PNG thumbnails are cached as files under `app.getPath("userData")/thumbnails` (DB stores thumbnail paths + failed flags).
- **UI:** Custom vanilla CSS (`styles.css`). `react-virtuoso` for rendering massive virtualized grid lists smoothly.
- **Thumbnail Generation:**
  - Runs in a completely detached, invisible `BrowserWindow` with `backgroundThrottling: false` to prevent macOS App Nap from freezing the worker.
  - Heavy 3D file parsing is offloaded from the main UI thread. Files are streamed directly into the hidden canvas using a custom `polytray://local/` protocol and `fetch()`, entirely bypassing slow Node-to-Chromium IPC ArrayBuffer serialization overhead.
  - A shared thumbnail job scheduler now provides single-flight execution, path-level dedupe, priority, cancellation of pending work, and bounded retry across scan-triggered, watcher-triggered, and manual thumbnail requests.
  - Thumbnail cache startup now reconciles a versioned cache metadata file, pruning orphaned PNGs and resetting the cache on version changes.
- **IPC Validation Architecture:**
  - High-risk IPC handlers now parse/normalize runtime payloads at the main-process boundary in `src/main/ipc/runtimeValidation.ts` before side effects run.
  - Runtime settings are normalized once and validated before scan, watcher, thumbnail, and preview-parse entry points execute.
- **Preview Loading Architecture:**
  - Interactive preview now uses one unified background-loading entrypoint for all formats.
  - Format-specific parse execution is selected through `src/renderer/lib/previewStrategies.ts` so the UI/viewer path stays unified while the heavy background step can vary by format.
  - `STL` and `OBJ` parse in a dedicated renderer `Worker` and rebuild meshes on the main viewer thread.
  - `3MF` preview parsing is routed through the existing hidden thumbnail `BrowserWindow` instead of the worker because `ThreeMFLoader` and local 3MF repair rely on DOM APIs such as `DOMParser` that are unavailable in a plain worker context.
  - Large `3MF` preview payloads now travel through a preload-brokered `MessagePort` path so geometry buffers can be transferred renderer-to-renderer without bouncing the full mesh payload back through normal main-process IPC cloning.
  - Shared mesh preparation/serialization logic lives in `src/renderer/lib/meshPrep.ts` and `src/renderer/lib/meshSerialization.ts` to keep thumbnail and preview behavior aligned.
- **Renderer Persistence Architecture:**
  - User-configurable settings are normalized and persisted in renderer `localStorage` via `src/shared/settings.ts`.
  - Library folder state (`libraryFolders`, `lastFolder`) is also renderer-owned in `localStorage` via `src/shared/libraryState.ts`.
  - Main-process `GET_LIBRARY_FOLDERS` / `GET_LAST_FOLDER` remain only as a migration fallback for older installs that still have legacy SQLite-backed values.
- **File Watching Architecture:**
  - Chokidar runs in a dedicated Electron `utilityProcess` (`src/main/worker.ts`) to avoid Main process event-loop starvation.
  - Main process orchestration/lifecycle lives in `src/main/watcher.ts` (start/stop + event bridge back into DB/UI updates).
- **Scanning Architecture:**
  - IPC scan handlers live in `src/main/ipc/scanning.ts` and handle folder scan/index flow, progress events, stale deletion, and thumbnail queue triggering.
- **Viewer Architecture:** Modular approach in `src/renderer/lib/`. The monolithic `viewer.ts` was refactored into focused chunks (`modelParsers.ts`, `orientation.ts`, `cameraUtils.ts`, `viewerConfig.ts`).

---

## 🚦 Current State

- **Current Version:** `v1.1.0` is ready for release via GitHub Actions (`electron-builder`).
- **Next Focus:** `v1.1.x` stabilization follow-up and release verification.

### Completed Features (v1.1.0)

- **T1:** Rendering Pipeline Unblocking — Offscreen Web Worker for thumbnails + async yielding for 3MF.
- **T2:** Viewer Architecture Refactoring — Modularized `viewer.ts`.
- **T3:** Database Performance — Added SQLite indexes for sorting.
- **T4:** Global IPC Signatures — Strongly typed IPC channels in `shared/types.ts`.
- **F1:** Enriched Filtering — Grid virtualization, sort by vertices/faces, filter by formats.
- **F2:** Sidebar Folder Hierarchy — Nested folder tree in sidebar, click-to-filter by directory.
- **F3:** Custom Colors — User-configurable accent, preview-material, and thumbnail-material colors via Settings, with per-color reset controls.
- **F5:** Target Folder Rescanning — Rescan individual folders from the sidebar.
- **TD1:** Render-on-Demand — Battery optimization (stops 60FPS loop when idle).
- **TD4:** Automated Schema Migrations — Formalized `user_version` pragma migrations in `database.ts` (expanded to v4 for Tags/Notes).
- **TD3:** Detached Background Thumbnail Window — Fully decoupled generation from main UI using a hidden browser window, `fetch()` streaming, and App Nap bypass.
- **Performance:** Solved pre-scan "beachball" UI freezes by chunking SQLite inserts (yielding to the Node event loop) and streaming large `.3mf` zip archives via `unzipper` instead of buffering into RAM.
- **TD2:** Structured logging via `electron-log` configured securely and correctly disabled in production unless specified.
- UX Bugfixes: Prevent 3MF rendering detail loss, loading % progress, infinite loop fix in `buildFolderTree`.
- **2026-03-07:**
  - Implemented subpath-appropriate naming for folders within the React sidebar hierarchy display.
  - Implemented per-folder thumbnail refresh targeting IPC capabilities.
  - Corrected thumbnail loading popups to show `file.path` absolutely for disambiguation.
  - Replaced inline sidebar folder actions with a native right-click Context Menu (`IPC.SHOW_FOLDER_CONTEXT_MENU`).
  - Set sidebar folder trees to spawn collapsed by default.
  - Fixed severe node event loop UI freeze during startup by shifting `chokidar` watch instantiation out of a `for` loop and batching multi-root watch subscriptions.
  - Further aggressively solved UI freeze thread starvation by completely removing `chokidar` from the Main process, wrapping it inside a dedicated OS `utilityProcess` spawned by `src/main/worker.ts` and bridging I/O events via `process.parentPort`.
- **2026-03-08:**
  - Consolidated thumbnail generation orchestration into a unified `thumbnails.ts` service.
  - Resolved Race Condition where Renderer grid reloaded before background rendering began.
  - Implemented live `onThumbnailReady` IPC bridge to update UI cards individually without full reloads.
  - Refactored `App.tsx` sorting/filtering to use a generalized `fetchFiles` utility.
- **2026-03-10:**
  - Unified interactive preview loading so all formats use a background parse pipeline from `PreviewPanel` instead of format-specific top-level branches.
  - Fixed severe interactive UI freeze when loading large `3MF` previews by moving `3MF` parsing off the visible renderer thread.
  - Added a hidden-renderer preview parse IPC path for `3MF` because `ThreeMFLoader` and `fix3MF()` depend on DOM APIs unavailable in a plain worker.
  - Added shared mesh prep + serialization helpers so preview and thumbnail paths preserve the same transforms/orientation semantics.
  - Added regression coverage for large-preview responsiveness and the real `/Volumes/exssd/3D Models/base.3mf` repro case.
  - Fixed a transform-loss regression in serialized `3MF` preview meshes by baking child world transforms before IPC transfer, restoring orientation parity with cached thumbnails.
  - Refactored preview parsing behind a strategy registry (`previewStrategies.ts`) so `PreviewPanel`/`viewer.ts` stay unified while `3MF` can continue using a DOM-capable hidden renderer and `STL`/`OBJ` remain on workers.
  - Reworked the `3MF` preview transport so preload owns the real `MessagePort` and forwards transferred geometry buffers directly to the visible renderer, avoiding the earlier full structured-clone IPC roundtrip.
  - Reduced `3MF` serialization overhead by reusing unshared geometries during transform baking instead of cloning every mesh geometry unconditionally.
  - Hardened the `base.3mf` E2E harness to locate the actual main window explicitly and to treat UI-freeze regression as the primary invariant; kept only a loose absolute load ceiling because machine/disk variance was too high for a tight timing budget.
  - Replaced path-prefix folder filtering with canonical containment checks for file queries, stale scan cleanup, folder thumbnail refresh, and folder removal.
  - Centralized settings validation/defaults in `src/shared/settings.ts` and removed main-process runtime reads of numeric settings from SQLite.
  - Moved library folder persistence to renderer `localStorage` with a one-time migration fallback from legacy SQLite keys.
  - Added a runtime IPC validation layer for scan, watcher, thumbnail, file-read, sort, and preview-parse entry points.
  - Added a shared thumbnail job scheduler covering scan, watcher, and manual thumbnail generation with queue stats logging and pending-job cancellation hooks.
  - Implemented the v1.1 low-risk polish pass: toolbar context chips, stronger file-card states, sidebar cleanup/reorder, calmer empty/progress states, and a cleaner preview/settings presentation.
  - Split the former single accent color into separate accent, preview, and thumbnail material colors; thumbnail generation now consumes the renderer-owned thumbnail color setting through runtime settings snapshots.
  - Added startup thumbnail cache reconciliation with versioned metadata plus orphaned-cache pruning.
  - Added explicit startup and scan performance budget tests in Playwright so regressions fail CI instead of relying on ad-hoc timing checks.
  - Added a schema migration test matrix covering upgrades from database versions 0 through 4 to the current schema.

---

## 🗺 Next Features Roadmap (Prioritized)

### Immediate Execution Plan (For Any New Agent Session)

> Objective: reduce ambiguity and make next engineering steps deterministic if conversation history is lost.

1. **TD5 Watcher Lifecycle Hardening (Do First)**
   - Implement `stopWatcher(): Promise<void>` semantics in `src/main/watcher.ts`.
   - On stop: send stop message, wait for `exit` with timeout, force kill on timeout fallback.
   - Ensure no duplicate `message` listeners accumulate after restart/reconfigure.
   - Add stress test scenario: rapid start/stop/restart cycles.

2. **TD7 Scan/Watch Write Conflict Mitigation (Do Second)**
   - Audit `INSERT OR REPLACE` usage in `src/main/ipc/scanning.ts` and `src/main/watcher.ts`.
   - Replace clobber-prone writes with conflict-safe upserts/updates that preserve newer state.
   - Define deterministic conflict policy (e.g., compare `modified_at` / `indexed_at` / thumbnail presence).
   - Add regression tests for concurrent scan + watcher updates.

3. **Preview Transfer Cost Reduction (Current Follow-up)**
   - The main freeze regression is fixed and the `3MF` transport no longer uses the slow invoke/result IPC path.
   - Remaining work, if revisited, should be driven by profiling `base.3mf` end-to-end timings across: hidden-renderer parse time, mesh serialization time, buffer transfer time, and viewer rebuild time.
   - Preserve orientation parity between cached thumbnails and interactive preview if any further `3MF` serialization or transport changes are made.

### Engineering Improvement Backlog (Priority + Impact + Effort)

> Objective: convert the current code/design/performance review into a concrete execution queue with expected payoff and scope.

1. **P0 Security: Canonicalize all thumbnail path reads**
   - **Impact:** High. Closes an obvious filesystem escape risk at the IPC boundary.
   - **Effort:** ~0.5-1 day.
   - **Primary Files:** `src/main/ipc/thumbnails.ts`, tests for path traversal/symlink cases.
   - **Why first:** Current `startsWith()` path checks are not a sufficient containment guard.
   - **Done when:** Thumbnail reads reject `..`, symlink escapes, and unrelated absolute paths with regression coverage.

2. **P0 Security: Restrict `polytray://local/` protocol reads to indexed/library files**
   - **Impact:** High. Prevents arbitrary local file access via the custom protocol.
   - **Effort:** ~1 day.
   - **Primary Files:** `src/main/index.ts`, potentially `src/main/ipc/files.ts`, protocol tests.
   - **Why second:** The protocol currently trusts decoded file paths too broadly.
   - **Done when:** Only canonicalized, allowed library paths are served and rejected paths fail closed.

3. **P1 Stability/Perf: Debounce renderer refreshes from watcher churn**
   - **Impact:** High for large libraries. Reduces repeated DB queries and UI reload storms during bursty file events.
   - **Effort:** ~0.5-1 day.
   - **Primary Files:** `src/renderer/App.tsx`.
   - **Why now:** `FILES_UPDATED` currently triggers immediate `fetchFiles()` on every event.
   - **Done when:** Bursty add/change/remove events coalesce into bounded UI refresh work without stale UI regressions.

4. **P1 Stability/Perf: Enforce single-flight thumbnail queue orchestration**
   - **Impact:** High. Prevents overlapping background loops, duplicate heavy parsing, and racey progress reporting.
   - **Effort:** ~1-2 days.
   - **Primary Files:** `src/main/thumbnails.ts`, `src/main/ipc/scanning.ts`.
   - **Why now:** Current queue entrypoints can start overlapping runs.
   - **Done when:** Queue requests dedupe by path, only one orchestrator runs at a time, and repeated full refreshes coalesce predictably.

5. **P1 Correctness: Replace path-prefix folder matching with containment-aware filtering**
  - **Impact:** Medium-high. Prevents sibling-path false positives like `/foo/bar` matching `/foo/bar2`.
  - **Effort:** ~1 day.
  - **Primary Files:** `src/main/ipc/files.ts`, `src/main/ipc/scanning.ts`, `src/main/ipc/library.ts`.
  - **Why now:** The current `LIKE '${folder}%'` strategy is logically incorrect for folder boundaries.
  - **Done when:** Folder filtering, stale deletion, and folder removal only affect the intended subtree.
  - **Status:** Completed on 2026-03-10 via canonical containment helper (`src/main/pathContainment.ts`) plus regression coverage.

6. **P1 Data Layer: Reduce scan-time DB roundtrips**
   - **Impact:** Medium-high on large libraries. Lowers scan latency and main-process pressure.
   - **Effort:** ~1-2 days.
   - **Primary Files:** `src/main/ipc/scanning.ts`, `src/main/database.ts`.
   - **Why now:** The scan loop performs per-file reads before writes.
   - **Done when:** Existing-row state is prefetched or batched efficiently and scan throughput improves measurably.

7. **P2 Renderer Architecture: Break `App.tsx` into focused hooks/modules**
   - **Impact:** Medium. Improves maintainability, testability, and reduces accidental coupling.
   - **Effort:** ~2-3 days.
   - **Primary Files:** `src/renderer/App.tsx`, new renderer hooks/modules.
   - **Why later:** Important, but lower urgency than security and queue correctness.
   - **Done when:** Bootstrapping, IPC subscriptions, library data orchestration, and progress state are separated cleanly.

8. **P2 Renderer Perf: Stop re-fetching stats/directories for every sort/search refresh**
   - **Impact:** Medium. Avoids unnecessary IPC/DB work during high-frequency user interactions.
   - **Effort:** ~0.5-1 day.
   - **Primary Files:** `src/renderer/App.tsx`.
   - **Why later:** Straightforward win once refresh semantics are cleaned up.
   - **Done when:** File-list refreshes are independent from stats/directory refreshes unless topology actually changes.

9. **P2 Memory/IPC Perf: Replace thumbnail data URLs with a less expensive transport**
   - **Impact:** Medium. Reduces base64 overhead, memory churn, and renderer state size.
   - **Effort:** ~1-2 days.
   - **Primary Files:** `src/main/ipc/thumbnails.ts`, `src/renderer/App.tsx`, `src/preload/index.ts`.
   - **Why later:** Valuable, but should follow path hardening and queue stabilization.
   - **Done when:** Thumbnails no longer require large base64 strings for steady-state rendering.

10. **P2 Quality: Remove timing-based E2E waits and add event-driven assertions**
    - **Impact:** Medium. Lowers flake rate and makes perf regressions easier to reason about.
    - **Effort:** ~1-2 days.
    - **Primary Files:** `tests/app.e2e.js`.
    - **Why later:** Testing quality matters, but product correctness/security still comes first.
    - **Done when:** Major workflows wait on observable app state instead of fixed sleeps.

11. **P3 React Hygiene: Resolve `set-state-in-effect` lint failure in preview loading**
    - **Impact:** Low-medium. Improves React correctness and keeps lint green.
    - **Effort:** ~0.5 day.
    - **Primary Files:** `src/renderer/components/PreviewPanel.tsx`.
    - **Why later:** Isolated issue, but worth addressing during renderer cleanup.
    - **Done when:** `npm run lint` passes without suppressing the rule.

12. **P3 IPC Robustness: Add runtime validation for high-risk handlers**
    - **Impact:** Medium. Complements TypeScript IPC typing with actual runtime safety.
    - **Effort:** ~1-2 days initial slice, more if expanded across all handlers.
    - **Primary Files:** `src/shared/types.ts`, `src/main/ipc/*.ts`, `src/preload/index.ts`.
    - **Why later:** Strong follow-on to the security hardening work.
    - **Done when:** High-risk inbound payloads are schema-validated and fail closed.

### Delivery Buckets

- **1-day bucket:** Protocol allowlisting, watcher/UI refresh debouncing, PreviewPanel lint cleanup.
- **3-day bucket:** Scan/write conflict mitigation, scan-time DB roundtrip reduction, thumbnail symlink-containment regression coverage.
- **1-week bucket:** App renderer decomposition, thumbnail transport profiling, watcher lifecycle hardening, E2E flake reduction.

### Recommended Sequence After TD5-TD9

1. Finish remaining filesystem hardening work: `polytray://local/` allowlisting, then thumbnail symlink-containment regression coverage.
2. Stabilize event/lifecycle behavior next: watcher refresh coalescing and watcher stop/restart hardening.
3. Resolve scan/write conflict semantics before deeper throughput work.
4. Optimize throughput once semantics are stable: reduce scan DB roundtrips and separate list refreshes from stats/directory refreshes.
5. Refactor renderer architecture and thumbnail transport only after the background/runtime contracts stop shifting.
5. Finish with test hardening and runtime validation so future regressions fail earlier in CI.

### Code Improvement Suggestions (Actionable)

- **Unify background runtime contracts**
  - Standardize request/event payload shape between main process and utility/background workers.
  - Define explicit semantics for progress, completion, error, and cancellation events.

- **Typed + runtime-validated IPC boundaries**
  - Keep TypeScript IPC channel typing (`src/shared/types.ts`) and add runtime validation for inbound payloads.
  - Fail closed with safe errors for malformed or unsafe requests.

- **Conflict-safe persistence patterns**
  - Prefer targeted `UPDATE`/upsert over broad `INSERT OR REPLACE` where state preservation matters.
  - Prevent accidental resets of `thumbnail`, `thumbnail_failed`, or newer metadata fields.

- **Thumbnail orchestration resilience**
  - Maintain dedupe/inflight maps and ensure repeated requests do not trigger duplicate heavy parsing.
  - Keep bounded concurrency and enforce timeout behavior from settings with safe min/max limits.

- **Data layer efficiency**
  - Reduce per-item DB roundtrips in thumbnail pipelines (avoid avoidable N+1 lookup paths).
  - Continue indexing strategy review as new sort/filter fields are introduced.

- **Security hardening baseline**
  - Canonicalize all filesystem IPC paths.
  - Ensure preload surface remains least-privilege and no unsafe renderer escape hatches are introduced.

- **Testing strategy upgrades**
  - Add migration test matrix for schema versions.
  - Add IPC contract tests, race regression tests, and worker lifecycle failure tests.

- **Customer-centric delivery guardrails**
  - For each feature PR, require: user problem statement, acceptance criteria, rollback path, and telemetry/review note.

### Engineering Standards & Design Practices

> Objective: capture repo-wide coding and architecture standards that should guide future changes beyond framework-specific performance rules. These are referenceable by ID in future discussions, reviews, and implementation notes.

- **EP1: Validate at process boundaries**
  - Treat all renderer-to-main IPC, preload APIs, custom protocol requests, and filesystem-facing inputs as untrusted.
  - Apply runtime validation, canonical path checks, and fail-closed behavior before any side effect.
  - Relevant files today: `src/main/ipc/*.ts`, `src/main/index.ts`, `src/preload/index.ts`.

- **EP2: One owner per subsystem**
  - Each major concern should have a single authoritative owner: settings, watcher lifecycle, thumbnail scheduling, viewer state, scan orchestration.
  - Avoid spreading the same responsibility across renderer callbacks, IPC handlers, and utility modules.
  - Use explicit service boundaries instead of shared incidental state.

- **EP3: Single source of truth for settings**
  - Settings should come from one typed schema with defaults, validation, persistence rules, and migration behavior.
  - Avoid split ownership between `localStorage`, renderer defaults, and SQLite-backed settings unless the division is intentional and documented.
  - Clamp and validate numeric settings centrally, not only in UI controls.
  - **Status:** Completed on 2026-03-10 via `src/shared/settings.ts` and `src/shared/libraryState.ts`; renderer `localStorage` now owns both user-configurable settings and library folder state, with validated runtime settings passed explicitly to main IPC consumers.

- **EP4: Prefer declarative state transitions over imperative synchronization**
  - Avoid patterns where state is set, then side effects patch the DOM, then more state is used to reconcile the result.
  - Favor reducers, explicit events, or small state machines for scan progress, preview loading, and background job status.
  - Timers should not be the primary correctness mechanism.

- **EP5: Keep domain logic separate from transport and UI**
  - Business rules like folder containment, queue dedupe, conflict resolution, retry policy, and thumbnail invalidation should live in service-layer logic.
  - IPC handlers should validate input, call domain services, and map errors, not own core policy decisions.

- **EP6: Prefer constrained types over stringly-typed control flow**
  - Use literal unions/enums for sort keys, action names, event phases, settings keys, and worker message types.
  - Reduce broad `string` inputs in shared contracts when the legal values are known ahead of time.
  - Keep `src/shared/types.ts` as the contract source of truth, but tighten it over time.

- **EP7: Canonical containment over string prefix matching**
  - Do not use path prefix or `LIKE '${folder}%'` semantics for security or correctness-sensitive folder matching.
  - Use canonicalized paths and explicit subtree containment checks instead.
  - This applies to thumbnail reads, folder filtering, stale deletion, protocol serving, and folder removal.

- **EP8: Make performance budgets explicit**
  - Every intentional delay, yield, or batching strategy should be justified by a measurable budget such as scan responsiveness, preview-interaction latency, or first-thumbnail latency.
  - Replace arbitrary sleeps with observable readiness conditions whenever possible.
  - Capture the reason for “magic numbers” in code comments or settings documentation.

- **EP9: Prefer React-owned UI over imperative DOM construction**
  - Three.js rendering can remain imperative, but UI chrome, controls, strips, and interactive overlays should be owned by React where practical.
  - Avoid ad hoc DOM construction, `innerHTML`, and manual event wiring for renderer-visible UI if React already owns that surface.

- **EP10: Accessibility is part of correctness**
  - Interactive UI should use semantic controls, keyboard support, focus handling, and explicit ARIA state where needed.
  - Clickable `div` patterns are acceptable only when there is a documented reason they cannot be semantic elements.

- **EP11: Structured logging and error taxonomy**
  - Prefer structured, category-based logging over ad hoc `console.*` calls.
  - Distinguish expected recoverable issues, operator-actionable warnings, and user-visible failures.
  - Main, renderer, thumbnail window, and utility worker logs should follow the same vocabulary.

- **EP12: Tests should observe contracts, not timing guesses**
  - Prefer waiting on emitted events, visible state transitions, or explicit readiness markers instead of fixed sleep durations.
  - High-risk areas should have targeted tests around lifecycle, queue semantics, path validation, and race handling in addition to broad E2E flows.

- **EP13: Tighten lint rules around architectural drift**
  - Keep lint fast, but use it to enforce discipline where regressions are common: promise handling, exhaustive branching, consistent type imports, and environment-specific globals.
  - Lint should catch structural mistakes early, not only syntax/style issues.

- **EP14: Document policy decisions where tradeoffs are non-obvious**
  - If a queue is single-flight, a watcher stop has timeout semantics, or a thumbnail failure is sticky, that policy should be written down in code and `DEV_CONTEXT.md`.
  - Future agents should not need to infer core behavior from scattered implementation details.

### Tech Debt

- **TD3b:** Background Runtime Consolidation (watching is in utilityProcess; evaluate whether thumbnail orchestration should also move to utilityProcess and define one unified background-runtime model).
- **TD5:** Watcher Lifecycle Hardening — graceful stop with timeout + forced kill fallback, prevent duplicate listeners during rapid restart/reconfigure.
- **TD6:** Thumbnail Job Scheduler — single-flight queue, dedupe by path, cancellation/coalescing to avoid overlapping full-library loops.
  - **Status:** Completed on 2026-03-10 via `src/main/thumbnailJobScheduler.ts` and integration in `src/main/thumbnails.ts`, `src/main/watcher.ts`, and `src/main/ipc/thumbnails.ts`.
- **TD7:** Scan/Watch Write Conflict Mitigation — avoid destructive `INSERT OR REPLACE` clobbers; preserve newer thumbnail/metadata state under races.
- **TD8:** IPC Path Security Hardening — canonical path containment checks (`resolve` + `relative`) for thumbnail reads.
  - **Status:** Partially completed on 2026-03-10 via canonical containment checks in thumbnail IPC; symlink-escape regression coverage remains open.
- **TD9:** Background Observability — queue depth, avg thumbnail latency, failure counters, worker restart metrics.
  - **Status:** Partially completed on 2026-03-10 via queue stats/timing logs and explicit startup/scan performance budgets; worker restart metrics and structured logging remain open.

### Stabilization Backlog (v1.1.x Recommended)

- **S1:** IPC Runtime Validation Layer — enforce runtime schema checks for all high-risk IPC entry points.
  - **Status:** Completed on 2026-03-10 via `src/main/ipc/runtimeValidation.ts` and handler integration in scan/system/files/thumbnails/preview IPC paths.
- **S2:** Background Job Queue Control — central dedupe/priority/cancel/retry policy shared by scan/watch/thumb flows.
  - **Status:** Completed on 2026-03-10 via `src/main/thumbnailJobScheduler.ts` and integration in `src/main/thumbnails.ts`, `src/main/watcher.ts`, and `src/main/ipc/thumbnails.ts`.
- **S3:** Startup + Scan Performance Budgets — codify measurable thresholds and fail CI/alerts on regression.
  - **Status:** Completed on 2026-03-10 via Playwright startup/scan budget tests in `tests/app.e2e.js`.
- **S4:** Schema Migration Test Matrix — verify upgrades from older `user_version` states to current schema.
  - **Status:** Completed on 2026-03-10 via `tests/databaseMigrations.test.js`.
- **S5:** Thumbnail Cache Lifecycle Plan — define cleanup, stale detection, and optional migration strategy if cache growth becomes problematic.
  - **Status:** Completed on 2026-03-10 via `src/main/thumbnailCacheLifecycle.ts` plus startup reconciliation and versioned cache metadata.

### Future Features (v1.2 Roadmap)

- **F6:** Interactive Tagging System
- **F15:** Configurable Advanced Settings (User-tunable magic numbers)
- **F7:** Model Notes & Descriptions
- **F8:** Print Status Tracking
- **F13:** Model Measurements & Dimensions
- **F9:** Slicer Integration (Open In...)
- **F11:** Virtual Collections (Projects/Themes)
- **F14:** Batch Operations
- **F10:** Duplicate Detection
- **F12:** Zip/Archive Browsing
- **F4:** Side-by-Side Model Comparison (Low priority)

### Future Features (v1.3+ Candidate Backlog)

- **F16:** Saved Views / Smart Filters — persist combinations of folder/tag/format/sort/search as reusable presets.
- **F17:** Model Health & Repair Assistant — flag non-manifold/inverted-normal risks and provide repair/open-in-tool suggestions.
- **F18:** Per-File Version History — track content-hash revisions over time and show "changed since last print/open" indicators.
- **F19:** Print Profile Compatibility — map models to printer/material/profile presets and warn on mismatch risks.
- **F20:** Dynamic Rule-Based Collections — auto-collections like "No Thumbnail", "High Poly", "Recently Changed", "Parse Failures".
- **F21:** Command Palette (Quick Actions) — global shortcut for navigation, rescan, retag, regenerate thumbnails, and "open in" flows.
- **F22:** Bulk Rename + Metadata Templates — apply naming conventions and template tags/notes during import or multi-select edits.
- **F23:** Import Rules Engine — auto-tagging/classification by folder, filename regex, extension, and optional dimensions.
- **F24:** Local Usage Insights — local-only stats such as most-opened, most-printed, and never-used models.
- **F25:** Background Indexing Controls — pause/resume/schedule indexing and optional CPU-throttling for large libraries.
- **F26:** Thumbnail Quality Profiles — user-selectable quality/resolution presets for battery vs fidelity tradeoffs.
- **F27:** Library Integrity Audit — one-click checks for missing files, stale records, broken thumbnails, and guided repair actions.

### Test Gaps (Action Items)

- **F2 (Sidebar Folders):** Need tests for nested DOM structure, expand/collapse chevron interactions, and top-level "All Models" filter reset.
- **F5 (Folder Rescanning):** Need tests verifying targeted scope (ignoring other folders) and behavior when targeted folder is physically deleted from disk.
- **Watcher Lifecycle:** Need stress tests for rapid start/stop/restart and validation that no orphan utility process or duplicate message listeners remain.
- **Scan+Watch Race Regression:** Need tests ensuring thumbnail/metadata consistency when watcher events arrive during active scan/index pass.
- **Thumbnail IPC Security:** Need tests for traversal/symlink edge-cases to verify reads are contained to thumbnail cache root.
- **Thumbnail Queue Dedupe:** Need tests proving repeated queue requests for the same file/path generate once and fan out updates safely.

---

## 💾 Core File Map Reference

- **React Entry:** `src/renderer/App.tsx`
- **Native DB & File Ops:** `src/main/database.ts` and `src/main/ipc/files.ts`
- **File System Watcher Runtime:** `src/main/watcher.ts` + `src/main/worker.ts`
- **Scan IPC Orchestration:** `src/main/ipc/scanning.ts`
- **Thumbnail Services / IPC:** `src/main/thumbnails.ts` + `src/main/ipc/thumbnails.ts`
- **Types / IPC Contracts:** `src/shared/types.ts`
- **3D Viewer Core:** `src/renderer/lib/viewer.ts` (manages lifecycle, imports from parsers/utils)
- **CSS Styles:** `src/renderer/styles.css`
