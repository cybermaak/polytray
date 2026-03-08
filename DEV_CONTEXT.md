# Polytray Development Context

**Important Context for AI Assistants:**
If you are an AI assistant reading this file at the start of a session, use it to understand the current architecture, recent progress, and immediate next steps for the Polytray project.

## 🛠 Maintenance Instructions for AI Assistants
1. **Always read this file** when continuing work on Polytray.
2. **Update this file** whenever a major milestone is reached, the architecture changes significantly, or new features are planned/completed.
3. **Move completed items** from the "Next Features Roadmap" to the "Completed Features" section.
4. **Preserve technical decisions** in the architecture section so future assistants understand *why* things were built a certain way (e.g., using Web Workers for thumbnails, SQLite structure).

---

## 🏗 Architecture & Stack
- **Frameworks:** Electron 34, React 19, Vite.
- **Languages:** TypeScript (Strict Mode).
- **Core 3D Engine:** Three.js (v170). Handles parsing (STL, OBJ, 3MF) and rendering.
- **Database:** `better-sqlite3`. Stores file metadata, vertex/face counts, and base64 PNG thumbnails in `~/.config/polytray/library.db`.
- **UI:** Custom vanilla CSS (`styles.css`). `react-virtuoso` for rendering massive virtualized grid lists smoothly.
- **Thumbnail Generation:**
  - Runs in a completely detached, invisible `BrowserWindow` with `backgroundThrottling: false` to prevent macOS App Nap from freezing the worker.
  - Heavy 3D file parsing is offloaded from the main UI thread. Files are streamed directly into the hidden canvas using a custom `polytray://local/` protocol and `fetch()`, entirely bypassing slow Node-to-Chromium IPC ArrayBuffer serialization overhead.
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

### Tech Debt
- **TD3 (Re-opened):** Background Worker (Partially completed for watching, needs review if thumbnails can be moved to worker too).

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

### Test Gaps (Action Items)
- **F2 (Sidebar Folders):** Need tests for nested DOM structure, expand/collapse chevron interactions, and top-level "All Models" filter reset.
- **F5 (Folder Rescanning):** Need tests verifying targeted scope (ignoring other folders) and behavior when targeted folder is physically deleted from disk.

---

## 💾 Core File Map Reference
- **React Entry:** `src/renderer/App.tsx`
- **Native DB & File Ops:** `src/main/database.ts` and `src/main/ipc/files.ts`
- **File System Watcher:** `src/main/ipc/scanning.ts`
- **Types / IPC Contracts:** `src/shared/types.ts`
- **3D Viewer Core:** `src/renderer/lib/viewer.ts` (manages lifecycle, imports from parsers/utils)
- **CSS Styles:** `src/renderer/styles.css`
