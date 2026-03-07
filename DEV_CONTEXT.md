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
  - Originally ran on the renderer main thread (which froze the UI).
  - Refactored to use an `OffscreenCanvas` inside a dedicated Web Worker (`thumbnail.worker.ts`) for STL and OBJ files.
  - 3MF parsing uses DOM APIs, so it falls back to the renderer main thread but yields via `requestAnimationFrame` to prevent freezing.
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
- **TD4:** Automated Schema Migrations — Formalized `user_version` pragma migrations in `database.ts`.
- UX Bugfixes: Prevent 3MF rendering detail loss, loading % progress, infinite loop fix in `buildFolderTree`.

---

## 🗺 Next Features Roadmap (Prioritized)

### Tech Debt
- **TD2:** Structured Logging (`electron-log`)
- **TD3:** Background Thumbnail Worker (fully decouple from main thread)

2. **F5: Target Folder Rescanning**
   - Provide a "rescan/sync" button next to individual folders in the sidebar tree.
   - Allows users to quickly update a specific directory without rescanning their entire multi-gigabyte library.

3. **F3: Custom Accent Colors**
   - Allow user to pick a custom UI accent color (replacing the default blue) inside Settings.
   - Also allow changing the default rendered 3D material color.

4. **F4: Side-by-Side Model Comparison**
   - Allow shifting the viewport into a split-screen or multi-model overlay to visually compare two distinct files. (High effort, low priority unless explicitly requested).

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
