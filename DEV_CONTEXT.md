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
- **File Watching Architecture:**
  - Chokidar runs in a dedicated Electron `utilityProcess` (`src/main/worker.ts`) to avoid Main process event-loop starvation.
  - Main process orchestration/lifecycle lives in `src/main/watcher.ts` (start/stop + event bridge back into DB/UI updates).
- **Scanning Architecture:**
  - IPC scan handlers live in `src/main/ipc/scanning.ts` and handle folder scan/index flow, progress events, stale deletion, and thumbnail queue triggering.
- **Viewer Architecture:** Modular approach in `src/renderer/lib/`. The monolithic `viewer.ts` was refactored into focused chunks (`modelParsers.ts`, `orientation.ts`, `cameraUtils.ts`, `viewerConfig.ts`).

---

## 🚦 Current State

- **Current Version:** `v1.0.0` was released via GitHub Actions (`electron-builder`).
- **Working Towards:** `v1.1.0`. Focusing on major Tech Debt cleanup and "Fit & Finish" UX features.

### Completed Features (v1.1.0)

- **T1:** Rendering Pipeline Unblocking — Offscreen Web Worker for thumbnails + async yielding for 3MF.
- **T2:** Viewer Architecture Refactoring — Modularized `viewer.ts`.
- **T3:** Database Performance — Added SQLite indexes for sorting.
- **T4:** Global IPC Signatures — Strongly typed IPC channels in `shared/types.ts`.
- **F1:** Enriched Filtering — Grid virtualization, sort by vertices/faces, filter by formats.
- **F2:** Sidebar Folder Hierarchy — Nested folder tree in sidebar, click-to-filter by directory.
- **F3:** Custom Accent Colors — User-configurable UI accent color + 3D preview material color via Settings.
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

---

## 🗺 Next Features Roadmap (Prioritized)

### Immediate Execution Plan (For Any New Agent Session)

> Objective: reduce ambiguity and make next engineering steps deterministic if conversation history is lost.

1. **TD5 Watcher Lifecycle Hardening (Do First)**
   - Implement `stopWatcher(): Promise<void>` semantics in `src/main/watcher.ts`.
   - On stop: send stop message, wait for `exit` with timeout, force kill on timeout fallback.
   - Ensure no duplicate `message` listeners accumulate after restart/reconfigure.
   - Add stress test scenario: rapid start/stop/restart cycles.

2. **TD8 IPC Path Security Hardening (Do Second)**
   - In `src/main/ipc/thumbnails.ts`, replace `thumbnailPath.startsWith(thumbDir)` checks.
   - Use canonical containment validation: `resolve(thumbnailPath)`, `relative(thumbDir, resolved)` and reject `..`/absolute escapes.
   - Add regression tests for traversal and symlink edge cases.

3. **TD7 Scan/Watch Write Conflict Mitigation (Do Third)**
   - Audit `INSERT OR REPLACE` usage in `src/main/ipc/scanning.ts` and `src/main/watcher.ts`.
   - Replace clobber-prone writes with conflict-safe upserts/updates that preserve newer state.
   - Define deterministic conflict policy (e.g., compare `modified_at` / `indexed_at` / thumbnail presence).
   - Add regression tests for concurrent scan + watcher updates.

4. **TD6 Thumbnail Job Scheduler (Do Fourth)**
   - Centralize queue orchestration in `src/main/thumbnails.ts`.
   - Enforce single-flight execution, dedupe by file path, coalesce repeated queue requests.
   - Add cancellation/replace semantics for full-library refresh operations.
   - Add queue dedupe tests and throughput assertions.

5. **TD9 Observability + Guardrails (Do Fifth)**
   - Add structured counters/logs: queue depth, thumb latency, failures, worker restarts.
   - Add perf guardrails for large libraries (batch size sanity bounds, timeout constraints).
   - Define and track performance budgets: scan start responsiveness, first thumbnail latency, full queue completion.

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

### Tech Debt

- **TD3b:** Background Runtime Consolidation (watching is in utilityProcess; evaluate whether thumbnail orchestration should also move to utilityProcess and define one unified background-runtime model).
- **TD5:** Watcher Lifecycle Hardening — graceful stop with timeout + forced kill fallback, prevent duplicate listeners during rapid restart/reconfigure.
- **TD6:** Thumbnail Job Scheduler — single-flight queue, dedupe by path, cancellation/coalescing to avoid overlapping full-library loops.
- **TD7:** Scan/Watch Write Conflict Mitigation — avoid destructive `INSERT OR REPLACE` clobbers; preserve newer thumbnail/metadata state under races.
- **TD8:** IPC Path Security Hardening — canonical path containment checks (`resolve` + `relative`) for thumbnail reads.
- **TD9:** Background Observability — queue depth, avg thumbnail latency, failure counters, worker restart metrics.

### Stabilization Backlog (v1.1.x Recommended)

- **S1:** IPC Runtime Validation Layer — enforce runtime schema checks for all high-risk IPC entry points.
- **S2:** Background Job Queue Control — central dedupe/priority/cancel/retry policy shared by scan/watch/thumb flows.
- **S3:** Startup + Scan Performance Budgets — codify measurable thresholds and fail CI/alerts on regression.
- **S4:** Schema Migration Test Matrix — verify upgrades from older `user_version` states to current schema.
- **S5:** Thumbnail Cache Lifecycle Plan — define cleanup, stale detection, and optional migration strategy if cache growth becomes problematic.

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
