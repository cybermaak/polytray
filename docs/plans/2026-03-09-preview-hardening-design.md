# Design: Preview Performance & Selection Hardening

**Date:** 2026-03-09
**Topic:** Non-blocking 3D Previews, Task Cancellation, and Selected Card UI

## 1. Problem Statement
1.  **Main Thread Blocking:** 3D model parsing (STL, OBJ, 3MF) is CPU-intensive and currently runs on the main renderer thread, causing the UI to freeze for several seconds on large models.
2.  **Race Conditions:** Rapidly switching models can lead to multiple loading tasks running concurrently, sometimes resulting in "ghost" models or the wrong model being displayed.
3.  **Missing Visual Feedback:** There is no visual indication of which model is currently "active" in the preview panel, making navigation difficult in dense grids.

## 2. Architecture & Components

### A. Non-Blocking Parsing (Web Worker)
*   **Worker Module:** Create a dedicated Web Worker (`src/renderer/lib/workers/parser.worker.ts`) to handle the heavy lifting.
*   **Formatters:** Move parsing logic from `modelParsers.ts` into a worker-safe environment (using `Transferable Objects` like `ArrayBuffer` for performance).
*   **Result Shape:** The worker will return "Geometry Data" (position/normal buffers) rather than full Three.js objects (which cannot be transferred across threads).

### B. Interruptible Loading (AbortController)
*   **PreviewPanel Logic:** Use a per-load `AbortController`.
*   **Cleanup:** When the `file` prop changes, call `abort()` on the previous controller immediately.
*   **Parser Integration:** The parsing loop (especially 3MF zip processing) will check `signal.aborted` at frequent intervals to stop work early.

### C. Selection UI (Option D: Accent Shadow)
*   **Indicator:** Implement the approved "Option D" style for selected cards.
*   **CSS:** `.file-card.selected` will feature a vibrant glowing shadow using `var(--accent-primary)` and maintain the hover border style.

## 3. Data Flow
1.  **User Click:** `App.tsx` updates `previewFile` state.
2.  **Preview Hook:** `PreviewPanel` starts `useEffect`.
    *   Old `AbortController` is triggered.
    *   New `AbortController` is created.
3.  **Parsing:** `Web Worker` reads file via `polytray://local/` and generates buffers.
4.  **Completion:** Main thread receives buffers, creates `THREE.BufferGeometry`, and mounts to the scene.
5.  **State Sync:** `App.tsx` passes `previewFile.id` down to `VirtuosoGrid` context to highlight the active card.

## 4. Testing & Edge Cases
*   **Rapid Clicking:** stress test by clicking 10 files in 1 second; only the final one should render.
*   **Massive Models:** Ensure a 500MB STL doesn't freeze the sidebar or toolbar during the "Processing" phase.
*   **Selection Persistence:** Ensure the selection highlight stays even if the grid is scrolled/virtualized.

## 5. Implementation Roadmap
1.  **Phase 1:** Selection UI Styles + `App.tsx` state plumbing.
2.  **Phase 2:** Web Worker parsing for STL (simplest format).
3.  **Phase 3:** `AbortController` integration in `PreviewPanel`.
4.  **Phase 4:** Web Worker parsing for OBJ and 3MF.
