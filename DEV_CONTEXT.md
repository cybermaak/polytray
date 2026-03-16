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
  - `3MF` preview loading now prefers a lightweight preview-only parser (`src/renderer/lib/fast3mfPreviewParser.ts`) that extracts only core mesh/component geometry and build transforms while ignoring materials and non-preview metadata; it falls back to `ThreeMFLoader` only for unsupported structures.
  - Large `3MF` preview payloads now travel through a preload-brokered `MessagePort` path so geometry buffers can be transferred renderer-to-renderer without bouncing the full mesh payload back through normal main-process IPC cloning.
  - Shared mesh preparation/serialization logic lives in `src/renderer/lib/meshPrep.ts` and `src/renderer/lib/meshSerialization.ts` to keep thumbnail and preview behavior aligned.
  - Preview phase timings are now emitted through structured main-process logs under `[PreviewMetrics]` so fetch/parse/serialize/build phases can be compared on real files.
- **Renderer Persistence Architecture:**
  - User-configurable settings are normalized and persisted in renderer `localStorage` via `src/shared/settings.ts`.
  - Library folder state (`libraryFolders`, `lastFolder`) is also renderer-owned in `localStorage` via `src/shared/libraryState.ts`.
  - Main-process `GET_LIBRARY_FOLDERS` / `GET_LAST_FOLDER` remain only as a migration fallback for older installs that still have legacy SQLite-backed values.
- **File Watching Architecture:**
  - Chokidar runs in a dedicated Electron `utilityProcess` (`src/main/worker.ts`) to avoid Main process event-loop starvation.
  - Main process orchestration/lifecycle lives in `src/main/watcher.ts` (start/stop + event bridge back into DB/UI updates).
  - Watcher lifecycle policy is centralized in `src/main/watcherLifecycle.ts`, including graceful stop, timeout-based forced kill fallback, and restart-safe listener ownership.
- **Scanning Architecture:**
  - IPC scan handlers live in `src/main/ipc/scanning.ts` and handle folder scan/index flow, progress events, stale deletion, and thumbnail queue triggering.
- **Viewer Architecture:** Modular approach in `src/renderer/lib/`. The monolithic `viewer.ts` was refactored into focused chunks (`modelParsers.ts`, `orientation.ts`, `cameraUtils.ts`, `viewerConfig.ts`).

---

## 🚦 Current State

- **Current Version:** `v1.1.0` is released and the GitHub Release pipeline is green across Ubuntu, macOS, and Windows.
- **Release State:** Tag `v1.1.0` now points at the post-release CI hardening fixes, and the GitHub Release entry is populated directly via Actions.
- **CI/CD State:**
  - `.github/workflows/build.yml` is now a straightforward `Build` workflow that runs on every push to `main` plus manual dispatch.
  - `.github/workflows/release.yml` remains tag-driven for `v*` releases and reuses the same setup/test and packaging logic.
  - Shared packaging logic lives in `.github/actions/package-app/action.yml`.
  - Artifact patterns were tightened to preserve Electron auto-update compatibility (`*.dmg`, `*-mac.zip`, `*.blockmap`, `latest*.yml`) while dropping unused `snap` artifacts.
  - Default CI now runs product tests only via `npm run test:product`.
  - Windows build stability was further hardened by removing the migration test suite's dependency on the external `sqlite3` CLI; migration fixtures are now created in-process with `better-sqlite3`, so product-unit tests are cross-platform.
  - The shared setup/test flow now installs dependencies with normal `npm ci` while setting `POLYTRAY_SKIP_INSTALL_APP_DEPS=1`, so package postinstall downloads Electron normally but skips the repo's Electron-native rebuild until after Node-side unit tests. Product tests then rebuild native deps for Electron immediately before Playwright E2E.
- **Test Architecture:**
  - Product tests live under `tests/product/`:
    - Playwright E2E: `tests/product/e2e/`
    - Node unit/integration tests: `tests/product/unit/{main,shared,renderer}/`
  - Repo verification tests live under `tests/repo/` and run separately via `npm run test:repo`.
  - Shared helpers/fixtures live under `tests/support/`.
  - One-off engineering helpers live under `tests/dev/`.
  - Node-side tests are now written in TypeScript and executed through `scripts/run-node-tests.mjs` with `tsx`.
- **Docs State:** `README.md` was refreshed into a landing-page style product overview, and the demo media under `docs/assets/` is now generated from the live app via `scripts/capture-readme-media.ts`.
- **Agent Docs State:** Root `AGENTS.md` now captures repo-specific working agreements, architecture gotchas, and a verification matrix for future contributors/agents.
- **Next Focus:** Post-`v1.1.0` release follow-up, remaining correctness/security hardening, and selective renderer/data-layer cleanup.

### Completed Features (v1.x.x)

#### Product Features

- **Pre-2026-03-07 · Foundation features shipped before the v1.1.0 stabilization pass**
  - **F1: Enriched filtering and browsing.** Added virtualized grid browsing, sort options that include model complexity fields such as vertices/faces, and format filters so large libraries remain navigable without rendering every card at once.
  - **F2: Sidebar folder hierarchy.** Added nested directory presentation in the sidebar so users can browse a large library by folder context instead of only by flat search and format filters.
  - **F5: Targeted folder rescanning.** Added per-folder rescan controls so users can refresh one library root without reprocessing the entire collection.

- **2026-03-07 · Sidebar and library interaction polish**
  - Improved sidebar naming so subpaths are labeled in a way that remains understandable even when multiple roots contain similarly named folders.
  - Added per-folder thumbnail refresh targeting and moved folder actions to a native context menu, which reduced inline UI clutter and made advanced folder actions more discoverable.
  - Defaulted folder trees to collapsed state so a large library does not overwhelm the sidebar immediately on launch.

- **2026-03-10 · Preview customization and UI polish for v1.1.0**
  - **F3: Split color customization.** Expanded the old single accent-color setting into separate accent, preview-material, and thumbnail-material colors, each with reset controls. This makes UI branding independent from model preview appearance.
  - Delivered the low-risk UI polish pass for `v1.1.0`: clearer toolbar context chips, stronger selected-card states, cleaner preview/settings presentation, calmer empty/progress states, and a tidier sidebar layout.

#### Tech Debt / Stability Work

- **Pre-2026-03-07 · Foundational runtime cleanup**
  - **TD1: Render-on-demand.** Replaced continuous viewer rendering with idle-aware rendering so the app does not burn power rendering frames unnecessarily.
  - **TD2: Structured logging.** Standardized logging through `electron-log`, with production-safe defaults and clearer separation between debug and normal runtime behavior.
  - **TD3: Detached thumbnail runtime.** Moved thumbnail generation out of the visible UI into a hidden `BrowserWindow`, streaming files via `fetch()` and bypassing slow ArrayBuffer IPC copies.
  - **TD4: Formal schema migrations.** Moved schema evolution onto explicit `user_version` migrations, making upgrades repeatable and testable.
  - **T2: Viewer modularization.** Broke up the old monolithic `viewer.ts` into smaller modules so preview parsing, orientation, camera behavior, and viewer configuration are easier to reason about.
  - **T3: Database performance baseline.** Added the first round of SQLite indexes for common sort paths so browsing and filtering remain responsive on larger libraries.
  - **T4: Typed IPC contracts.** Centralized shared channel signatures in `src/shared/types.ts`, reducing drift between renderer, preload, and main process.

- **2026-03-07 · Watcher and startup freeze reduction**
  - Fixed severe startup UI stalls by removing large synchronous watch setup from the main process hot path.
  - Moved `chokidar` watching into a dedicated `utilityProcess`, which isolated file-system event churn from the Electron main process and materially reduced beachball-style freezes.

- **2026-03-08 · Thumbnail orchestration cleanup**
  - Consolidated thumbnail orchestration into `src/main/thumbnails.ts` and fixed a race where the renderer refreshed before background thumbnail generation had actually started.
  - Added the `onThumbnailReady` bridge so individual cards can update as thumbnails arrive instead of waiting for a full list reload.

- **2026-03-10 · Major v1.1.0 hardening pass**
  - **Folder containment correctness.** Replaced string-prefix folder matching with canonical containment checks so sibling folders such as `/foo/bar` and `/foo/barista` are no longer confused.
  - **Settings single source of truth.** Moved settings and library folder persistence to typed renderer-owned `localStorage` models, with validated runtime snapshots passed into main-process work instead of ad hoc SQLite reads.
  - **Runtime IPC validation.** Added validation and normalization at high-risk IPC boundaries so scan, watcher, file, sort, thumbnail, and preview entry points fail more safely on malformed input.
  - **Shared thumbnail scheduler.** Added a single-flight thumbnail scheduler with dedupe, queueing, retry behavior, and queue stats instead of scattered overlapping thumbnail loops.
  - **Thumbnail cache lifecycle management.** Added versioned cache metadata plus orphan pruning so cached thumbnails do not accumulate silently across layout/runtime changes.
  - **Schema migration coverage.** Added a migration test matrix for versions 0 through 4 so database evolution is no longer validated only by live upgrades.
  - **Performance budget checks.** Added startup and scan budget tests so major regressions are detected in CI instead of only through manual observation.

- **2026-03-13 · Post-release stability hardening**
  - **TD5: Watcher lifecycle hardening.** Added restart-safe watcher lifecycle management, graceful stop semantics, and forced-kill fallback so quick stop/start/reconfigure cycles do not leave zombie listeners behind.
  - **TD7: Scan/watch write conflict mitigation.** Centralized merge policy in `src/main/fileIndexing.ts` so scan and watcher updates now obey one deterministic “newer `modified_at` wins” rule.
  - **TD8: Filesystem access hardening.** Restricted `polytray://local/` to indexed model files and contained thumbnail-cache paths; thumbnail reads now rely on canonical containment rather than path-prefix assumptions.
  - Added debounced renderer refresh handling so bursty watcher updates no longer trigger immediate repeated file-list fetches.

- **2026-03-14 · 3MF preview parsing hardening**
  - Added lightweight `3MF` preview parsing for the common “geometry only” case and tightened fallback rules so unsupported 3MF structures still route through `ThreeMFLoader`.
  - Preserved orientation parity and avoided several regressions by limiting the lightweight path to well-understood archive structures instead of trying to parse every 3MF dialect.

#### Engineering Excellence Tasks

- **2026-03-10 · Preview architecture unification**
  - Unified preview loading under one background-loading entrypoint so `PreviewPanel` no longer branches into fundamentally different top-level flows per format.
  - Added `previewStrategies.ts` so format-specific execution can vary internally while the viewer-facing preview contract stays consistent.

- **2026-03-10 · 3MF background parsing and transport redesign**
  - Moved expensive `3MF` parsing out of the visible renderer and into a DOM-capable hidden renderer because the upstream loader depends on DOM APIs unavailable inside a plain worker.
  - Introduced shared mesh preparation and serialization utilities so thumbnail and preview pipelines preserve the same transforms and orientation assumptions.
  - Reworked `3MF` preview transport to use a preload-brokered `MessagePort`, reducing avoidable main-process structured-clone overhead during large preview loads.

- **2026-03-11 · Repo and release collateral improvements**
  - Rebuilt the README into a product-style landing page, regenerated the screenshot/demo media from the live app, and checked in the related design notes and mockups so future contributors can trace how the polish work was meant to land.

- **2026-03-12 · CI and test architecture cleanup**
  - Removed the old “daily build” concept and replaced it with a simpler split: normal push-driven `Build` workflow and tag-driven `Release` workflow.
  - Extracted shared packaging logic into `.github/actions/package-app/action.yml`.
  - Reorganized tests into `product`, `repo`, `support`, and `dev` buckets, converted the active suite to TypeScript, and kept repo-only checks out of the default product gate.

- **2026-03-14 · Cross-platform CI hardening**
  - Fixed Windows CI by replacing migration fixtures that shell out to `sqlite3` with in-process `better-sqlite3` fixture creation.
  - Fixed macOS CI by separating “install Electron itself” from “rebuild Electron-native modules for this repo,” preventing arm64 install failures without compromising E2E coverage.

#### Non-Functional Improvements

- **Pre-2026-03-07 · Early performance wins**
  - Removed large startup freezes by chunking SQLite insert work and by streaming large `.3mf` archives instead of buffering them fully into memory.
  - Fixed smaller UX regressions such as rendering detail loss in 3MF previews, missing progress feedback, and a folder-tree infinite loop.

- **2026-03-13 · Preview transport cost reduction**
  - Introduced compact preview mesh serialization that drops unused attributes for interactive preview while preserving normals, indices, and baked transforms. This reduced transport cost without forking the viewer contract.

- **2026-03-14 · Measured 3MF preview performance improvements**
  - Added structured preview-phase metrics and used them to identify parsing, not transfer, as the dominant remaining bottleneck for large `3MF` preview loads.
  - For `/Volumes/exssd/3D Models/base.3mf`, the lightweight preview parser reduced total load time from roughly `49.8s` to roughly `6.9s`, with hidden-renderer parse time dropping from roughly `46.0s` to roughly `4.7s`.

---

## 🗺 Future Roadmap

### Near-Term Engineering Work (Target: v1.1.1 / v1.1.x)

- **P1 Data Layer: Reduce scan-time DB roundtrips**  
  - **Proposed milestone:** `v1.1.1`
  - The scan pipeline still performs too many per-file reads before writes. The next targeted optimization should prefetch or batch existing-row state so large-library scans generate less main-process and SQLite overhead.

- **P1 Security/Test Coverage: Add symlink-escape coverage for thumbnail and protocol path checks**  
  - **Proposed milestone:** `v1.1.1`
  - The containment rules themselves are in place, but regression tests still need to prove that symlink-based escape attempts are rejected consistently. This is a correctness and safety follow-up, not a new security model.

- **P1 Stability/Test Coverage: Add high-level watcher churn and scan+watch race tests**  
  - **Proposed milestone:** `v1.1.1`
  - Unit coverage exists for lifecycle and merge policy, but the repo still lacks stress-style product tests that drive the real watcher process while scans are in flight. This is the main remaining gap in the post-release hardening work.

- **P2 Renderer/Data Flow: Stop re-fetching stats and directories on every sort/search refresh**  
  - **Proposed milestone:** `v1.1.x`
  - File-list refreshes are currently heavier than they need to be. Splitting “list changed” from “library topology changed” would reduce needless IPC traffic and keep the UI snappier during rapid filter/search interaction.

- **P3 React Hygiene: Resolve the `set-state-in-effect` lint failure in `PreviewPanel`**  
  - **Proposed milestone:** `v1.1.x`
  - This is a contained cleanup task, but worth doing so lint becomes a reliable signal again and preview-state transitions stay predictable.

### Planned Product Features (Target: v1.2)

- **F6: Interactive Tagging System**  
  - **Proposed milestone:** `v1.2`
  - Add first-class tagging so users can organize models across folders and formats. This is the most natural next feature because it unlocks richer search, collections, and status workflows without changing the core library model.

- **F7: Model Notes & Descriptions**  
  - **Proposed milestone:** `v1.2`
  - Let users attach lightweight notes to a model record. This pairs well with tags and creates a place for print tips, source links, or change notes without inventing a full asset-management system.

- **F8: Print Status Tracking**  
  - **Proposed milestone:** `v1.2`
  - Track whether a model is unprinted, testing, validated, failed, or archived. This would make Polytray more useful as a working print library rather than only a file browser.

- **F9: Slicer Integration ("Open In…")**  
  - **Proposed milestone:** `v1.2`
  - Add user-configurable handoff into slicers or related tools. This is a pragmatic workflow improvement and aligns well with the existing context-menu and drag support.

- **F10: Duplicate Detection**  
  - **Proposed milestone:** `v1.2`
  - Detect likely duplicates by hash or strong heuristics so users can reduce clutter in large model libraries. This is especially valuable once tags/notes/statuses make library hygiene more important.

- **F11: Virtual Collections (Projects / Themes)**  
  - **Proposed milestone:** `v1.2`
  - Allow users to gather models into named collections independent of on-disk folder structure. This complements tagging but gives a more deliberate project-oriented workflow.

- **F12: Zip / Archive Browsing**  
  - **Proposed milestone:** `v1.2`
  - Allow browsing archives without a manual extract step. This is a common real-world distribution format for 3D model sets and fits Polytray’s local-library focus.

- **F13: Model Measurements & Dimensions**  
  - **Proposed milestone:** `v1.2`
  - Surface basic dimensions directly in metadata and search. This is a frequent practical need when picking a model for a printer or assembly constraint.

- **F14: Batch Operations**  
  - **Proposed milestone:** `v1.2`
  - Add multi-select workflows for retagging, thumbnail refresh, status changes, or collection assignment. This becomes more important once richer metadata features land.

- **F15: Configurable Advanced Settings**  
  - **Proposed milestone:** `v1.2`
  - Expose selected tunables that are currently hard-coded or only implicitly configurable. This should stay narrow and purposeful rather than turning into a dumping ground for every magic number.

- **F4: Side-by-side Model Comparison**  
  - **Proposed milestone:** `v1.2` if demand appears, otherwise defer
  - Useful for variants and printer tests, but lower priority than metadata and workflow features. Keep it on the feature list, but do not let it displace more broadly useful library-management work.

### Candidate Backlog (v1.3+)

- **F16: Saved Views / Smart Filters**  
  - Save combinations of folder, tag, search, sort, and format filters as reusable presets. This becomes much more valuable after tags, notes, and status fields exist.

- **F17: Model Health & Repair Assistant**  
  - Surface likely mesh issues and route users toward repair workflows. This is a good long-term fit, but should follow the current preview/parser stabilization work.

- **F18: Per-File Version History**  
  - Track content-hash revisions and show when a model changed since last use or print. Useful, but it introduces real lifecycle and storage questions that are better tackled after metadata features settle.

- **F19: Print Profile Compatibility**  
  - Associate models with printer/material/profile presets and warn on mismatches. Strong workflow value, but it depends on a more mature metadata layer.

- **F20: Dynamic Rule-Based Collections**  
  - Auto-build collections like “No Thumbnail,” “High Poly,” “Recently Changed,” or “Parse Failures.” This should piggyback on richer metadata and tagging rather than arrive first.

- **F21: Command Palette (Quick Actions)**  
  - Provide keyboard-centric access to navigation and common actions. Good fit for power users, but not core to current release stabilization.

- **F22: Bulk Rename + Metadata Templates**  
  - Apply naming and metadata conventions during import or multi-select edits. Valuable once tagging/status/notes exist.

- **F23: Import Rules Engine**  
  - Auto-classify models by folder, filename, extension, or dimensions. This is likely better as a later-stage feature once manual tagging and notes establish the right data model.

- **F24: Local Usage Insights**  
  - Track local-only usage patterns such as most opened or never used. Useful, but not urgent compared with workflow fundamentals.

- **F25: Background Indexing Controls**  
  - Expose pause/resume/throttle/schedule controls for large libraries. This is a likely future quality-of-life feature once the background runtime model is fully stable.

- **F26: Thumbnail Quality Profiles**  
  - Offer fidelity-vs-speed presets for thumbnail generation. Valuable, but should follow more impactful runtime and workflow work.

- **F27: Library Integrity Audit**  
  - Provide one-click checks for missing files, stale records, broken thumbnails, and guided repair actions. This is a strong long-term maintenance feature once the metadata and cache lifecycle stabilize further.

### Future Tech Debt and Platform Work

- **TD3b: Background runtime consolidation**  
  - Evaluate whether thumbnail orchestration should move into the same background-runtime model as file watching, or whether the current split between hidden renderer, utility process, and worker should remain intentional. This is primarily an architectural simplification question.

- **TD9: Background observability expansion**  
  - Queue depth and timing logs now exist, but worker restart metrics, richer failure counters, and clearer taxonomy across main/renderer/background logs remain open. This is valuable operationally but not blocking product work.

- **App shell decomposition**  
  - `src/renderer/App.tsx` still owns a lot of orchestration. Breaking it into focused hooks/modules is more maintainability work than user-facing feature work, so it should land when product scope is calm enough to support it.

- **Thumbnail transport modernization**  
  - Thumbnails still travel as data URLs in steady-state UI rendering. There is room to reduce memory overhead and renderer churn later, but it should follow higher-value correctness and throughput work.

### Test and Verification Backlog

- **Sidebar hierarchy interaction tests**  
  - The folder tree works, but expand/collapse behavior, nested DOM structure, and “All Models” reset behavior still deserve explicit product coverage.

- **Folder-rescan targeting tests**  
  - The per-folder rescan feature needs stronger tests proving it ignores unrelated roots and behaves correctly when the targeted folder was deleted from disk.

- **Thumbnail queue dedupe tests**  
  - The queue scheduler exists, but repeated requests for the same path still need contract-level tests proving work is deduped and updates fan out safely.

- **Event-driven E2E cleanup**  
  - The suite is much healthier than before, but there is still room to replace more fixed sleeps with explicit readiness markers and event-driven assertions.

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
  - **Status:** Completed on 2026-03-13 via `src/main/watcherLifecycle.ts`, `src/main/watcher.ts`, `src/main/worker.ts`, and `tests/product/unit/main/watcherLifecycle.test.ts`.
- **TD6:** Thumbnail Job Scheduler — single-flight queue, dedupe by path, cancellation/coalescing to avoid overlapping full-library loops.
  - **Status:** Completed on 2026-03-10 via `src/main/thumbnailJobScheduler.ts` and integration in `src/main/thumbnails.ts`, `src/main/watcher.ts`, and `src/main/ipc/thumbnails.ts`.
- **TD7:** Scan/Watch Write Conflict Mitigation — avoid destructive `INSERT OR REPLACE` clobbers; preserve newer thumbnail/metadata state under races.
  - **Status:** Completed on 2026-03-13 via `src/main/fileIndexing.ts`, `src/main/ipc/scanning.ts`, `src/main/watcher.ts`, and `tests/product/unit/main/fileIndexing.test.ts`.
- **TD8:** IPC Path Security Hardening — canonical path containment checks (`resolve` + `relative`) for thumbnail reads.
  - **Status:** Mostly completed on 2026-03-13 via canonical containment checks in thumbnail IPC plus indexed-path allowlisting for `polytray://local/`; symlink-escape regression coverage remains open.
- **TD9:** Background Observability — queue depth, avg thumbnail latency, failure counters, worker restart metrics.
  - **Status:** Partially completed on 2026-03-10 via queue stats/timing logs and explicit startup/scan performance budgets; worker restart metrics and structured logging remain open.

### Stabilization Backlog (v1.1.x Recommended)

- **S1:** IPC Runtime Validation Layer — enforce runtime schema checks for all high-risk IPC entry points.
  - **Status:** Completed on 2026-03-10 via `src/main/ipc/runtimeValidation.ts` and handler integration in scan/system/files/thumbnails/preview IPC paths.
- **S2:** Background Job Queue Control — central dedupe/priority/cancel/retry policy shared by scan/watch/thumb flows.
  - **Status:** Completed on 2026-03-10 via `src/main/thumbnailJobScheduler.ts` and integration in `src/main/thumbnails.ts`, `src/main/watcher.ts`, and `src/main/ipc/thumbnails.ts`.
- **S3:** Startup + Scan Performance Budgets — codify measurable thresholds and fail CI/alerts on regression.
  - **Status:** Completed on 2026-03-10 via Playwright startup/scan budget tests in `tests/product/e2e/app.e2e.ts`.
- **S4:** Schema Migration Test Matrix — verify upgrades from older `user_version` states to current schema.
  - **Status:** Completed on 2026-03-10 via `tests/product/unit/main/databaseMigrations.test.ts`.
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
- **Watcher Lifecycle:** Need higher-level stress coverage for rapid start/stop/restart against the real utility process, not just the lifecycle manager contract.
- **Scan+Watch Race Regression:** Need tests ensuring thumbnail/metadata consistency when watcher events arrive during active scan/index pass.
- **Thumbnail IPC Security:** Need tests for traversal/symlink edge-cases to verify reads are contained to thumbnail cache root.
- **Thumbnail Queue Dedupe:** Need tests proving repeated queue requests for the same file/path generate once and fan out updates safely.

---

## 💾 Core File Map Reference

- **Renderer App Shell:** `src/renderer/App.tsx`
- **Renderer UI Components:** `src/renderer/components/` (`Sidebar.tsx`, `Toolbar.tsx`, `PreviewPanel.tsx`, `SettingsModal.tsx`, `AppIcon.tsx`, `ErrorBoundary.tsx`, `iconPaths.ts`)
- **Renderer Viewer Pipeline:** `src/renderer/lib/viewer.ts`, `src/renderer/lib/previewStrategies.ts`, `src/renderer/lib/modelParsers.ts`, `src/renderer/lib/meshPrep.ts`, `src/renderer/lib/meshSerialization.ts`, `src/renderer/lib/orientation.ts`, `src/renderer/lib/cameraUtils.ts`, `src/renderer/lib/viewerConfig.ts`
- **Renderer 3D Helpers:** `src/renderer/lib/formatters.ts`, `src/renderer/lib/threemf-repair.ts`
- **Renderer Workers:** `src/renderer/lib/workers/parser.worker.ts`
- **Renderer Styling / HTML Entrypoints:** `src/renderer/styles.css`, `src/renderer/index.html`, `src/renderer/thumbnail.html`, `src/renderer/main.tsx`, `src/renderer/thumbnail.ts`
- **Preload Bridge:** `src/preload/index.ts`
- **Shared Contracts / Local Persistence Models:** `src/shared/types.ts`, `src/shared/settings.ts`, `src/shared/libraryState.ts`
- **Database / Schema / Metadata:** `src/main/database.ts`, `src/main/metadata.ts`
- **Main IPC Surface:** `src/main/ipc/`
  - `files.ts` for file queries and sort/filter fetches
  - `library.ts` for folder selection/removal and library-scoped actions
  - `scanning.ts` for scan orchestration and stale cleanup
  - `thumbnails.ts` for thumbnail-related IPC entry points
  - `runtimeValidation.ts` for high-risk payload parsing/normalization
  - `system.ts` for app/system operations
- **Thumbnail Runtime:** `src/main/thumbnails.ts`, `src/main/thumbnailJobScheduler.ts`, `src/main/thumbnailCacheLifecycle.ts`, `src/renderer/lib/thumbnailRenderer.ts`
- **Watcher Runtime:** `src/main/watcher.ts`, `src/main/watcherLifecycle.ts`, `src/main/worker.ts`
- **Renderer Refresh Utilities:** `src/renderer/lib/refreshDebouncer.ts`
- **Filesystem / Path Safety Helpers:** `src/main/pathContainment.ts`, `src/main/localFileProtocol.ts`, `src/main/scanner.ts`
- **Electron Main Entrypoint / Protocols:** `src/main/index.ts`
- **Build Assets / Packaging:** `build/icon.png`, `build/scripts/afterPack.js`
- **GitHub Actions / Release Automation:** `.github/workflows/build.yml`, `.github/workflows/release.yml`, `.github/actions/setup-and-test/action.yml`, `.github/actions/package-app/action.yml`
- **Product Test Suite:** `tests/product/`
  - `e2e/app.e2e.ts`
  - `unit/main/`
  - `unit/shared/`
  - `unit/renderer/`
- **Repo Verification Tests:** `tests/repo/` (`ci/`, `docs/`, `structure/`, `ui/`)
- **Shared Test Support:** `tests/support/helpers/`, `tests/support/fixtures/`
- **One-off Engineering Test Utilities:** `tests/dev/`
- **Docs / Design Notes / Capture Scripts:** `docs/plans/`, `docs/mockups/`, `docs/assets/`, `scripts/capture-readme-media.ts`, `scripts/run-node-tests.mjs`
