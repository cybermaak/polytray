# Browsing and product UI tasks

Read [contracts C2, C3, C4, C7-C9](contracts.md) and the [tracker](tracker.md). U alone owns App, FileGrid, Toolbar, Sidebar, ScanProgress, BatchActionsBar, ComparePanel, SettingsModal, and application CSS. V owns PreviewPanel. Work on U tasks is serial within those files, even when backend work runs concurrently.

## U01 - Load every result and keep selection consistent across pages

**Priority:** P1. **Dependencies:** D02, T03. **Owner:** U.

**Own:** `src/renderer/App.tsx`, `src/renderer/components/FileGrid.tsx`, `ComparePanel.tsx`, `BatchActionsBar.tsx`, `src/renderer/lib/archiveDisplay.ts`; new `src/renderer/hooks/useLibraryPages.ts`, page reducer tests, and `tests/product/e2e/library-pages.e2e.ts`.

**Steps:**

1. Add the failing 600-file and collection-only-record-600 flows. Add >one-page archive, page-boundary sort ties, empty collection, interrupted next-page request, and query-change-during-fetch cases.
2. Implement a reducer/hook for C2 query generation, current revision, loaded pages, totalItems/totalModels, pending requests, and recoverable page errors. Send collection paths to the query service; remove post-page collection filtering and post-page archive collapsing.
3. Wire Virtuoso `endReached`, stable item keys, loading/error footer, deduped append, and retry. Ignore stale responses. Preserve current results during same-scope refresh; never mix revisions. Keep at most one next-page request for a generation.
4. Show accurate totals independent of loaded count. For grouped archives, show item/model counts with understandable labels, such as "32 items / 120 models"; inside file-only scopes show matching model total. A loaded count may be secondary, never the sole result total.
5. Preserve selected real records across appended pages. Apply C2's explicit clear-on-query-change policy, update selected records after mutations, and handle deletion without leaving an invisible batch action. Archive summaries cannot enter file-ID batch operations. Remove unsafe memo equality that ignores visible metadata or captures stale callbacks; use stable callbacks/props or a complete comparison.
6. Install T03's component in cards, archive samples, and compare. Patch thumbnail-ready into FileRecord using the path/revision only; delete App's eager data-URL conversion. Forward cache invalidation events. Demonstrate actual newly generated thumbnails becoming visible.
7. Supply V02 with the archive PreviewTarget and lazy-query client while preserving regular file preview. Coordinate its callback/prop wiring instead of editing PreviewPanel here.

**Acceptance:** Every fixture item is reachable and counted correctly; collection record 600 appears. Archives are complete across page boundaries. Selection/actions never silently target a previous filter. A ready thumbnail becomes visible without an access-denied request. Metadata updates are reflected in memoized cards.

**Verify:** Type, renderer Unit, Build, Product including scroll to record 600, mixed archive paging, compare/batch state, and thumbnail-arrival regression.

## U02 - Unify search state and refresh only what changed

**Priority:** P2. **Dependencies:** U01, D03. **Owner:** U.

**Own:** `src/renderer/App.tsx`, `src/renderer/components/Toolbar.tsx`, `Sidebar.tsx`, library-page hook, existing refresh-debouncer helper/tests; new `tests/product/e2e/search-state.e2e.ts`.

**Steps:**

1. Add a failure for typing, dismissing the search chip, and waiting beyond the debounce: input, query, chip, and results must all remain cleared. Cover rapid type/clear/type, external scope reset, unmount, and stale query completion.
2. Make one owner authoritative for search draft/committed query. Cancel a pending debounce on clear, external reset, and unmount. Avoid two independently persisted sources of search truth. Preserve the existing short typing debounce unless measurements justify changing it.
3. Consume D03's mutation flags. List refreshes fetch pages only; stats/topology refresh independently on their revisions. Start independent required reads concurrently rather than sequentially blocking the list.
4. Keep folder-tree inputs stable when topology did not change. Update metadata/thumbnail rows directly when possible, and query again only when filtering/order may change. Coalesce bursty scan/watch list invalidations without losing the final refresh.
5. Add request-count assertions showing sort/search/pagination trigger no warm stats or directory query. Verify collection/folder/format chips clear exactly their own scope and invalidate the appropriate page generation.

**Acceptance:** Search cannot reappear after clear; chip and field always describe the applied query. Repeated filtering no longer rebuilds summaries/topology. Fast query changes cannot display an old result set.

**Verify:** Type, renderer Unit, Product for keyboard typing/chip flows, IPC request counts, and event bursts.

## U03 - Keep browsing usable at every supported window size

**Priority:** P2. **Dependencies:** F01, F02. **Owner:** U.

**Own:** `src/renderer/styles.css`, `src/renderer/App.tsx`, `Sidebar.tsx`; new `src/renderer/lib/panelLayout.ts`, layout tests, and `tests/product/e2e/responsive-layout.e2e.ts`. V applies small PreviewPanel sizing/overlay props; coordinator owns shared persistence normalization.

**Steps:**

1. Add measurements/screenshots at 900 x 600, 1280 x 800, and 1920 x 1080 with default, minimum, and maximum saved panel sizes. Assert the 900-width reproduction no longer leaves a zero-width browse area.
2. Implement C7's dock/overlay decision as a pure width calculation using actual sidebar/window sizes. Preserve a 400px docked browse minimum, 320px preview minimum, and 360px preferred preview width. Clamp resizes without causing drag jitter or oscillation at the breakpoint.
3. In narrow windows overlay preview over content, leaving the underlying grid laid out and scroll position intact. Keep close/expand controls reachable; indicate modal focus behavior for U04. Expanded mode remains explicit and separate from the narrow overlay.
4. Persist preferred sidebar/preview sizes with normalized bounds. Save user intent, not the temporary clamp applied to a smaller window. Restore normal sizes after enlarging the window.
5. Confirm ResizeObserver/session invalidation updates camera dimensions once per effective change. Apply requested V02 error-state and V05 parts-strip classes in scoped sections when those consumers are ready; do not mix unrelated visual redesign into this task.

**Acceptance:** Browsing remains usable at minimum size; 1280-width defaults allow more useful grid space. Oversized saved widths never hide content or controls. Dragging, overlay close, expand, and window resize preserve selection and scroll position.

**Verify:** Type, pure layout Unit, Product with dimension assertions and visual captures. Include light/dark mode and long names, not only an empty library.

## U04 - Support keyboard navigation and predictable focus

**Priority:** P2 product accessibility. **Dependencies:** U01, U03, V02. **Owner:** U.

**Own:** `FileGrid.tsx`, `Sidebar.tsx`, `Toolbar.tsx`, `BatchActionsBar.tsx`, `SettingsModal.tsx`, `App.tsx`, `styles.css`; new `src/renderer/hooks/useOverlayFocus.ts`, `src/renderer/lib/gridNavigation.ts`, navigation unit tests, and `tests/product/e2e/keyboard-navigation.e2e.ts`. V applies PreviewPanel callback changes.

**Steps:**

1. Add a keyboard-only journey: enter library, move among cards, reach another page, preview, close, multi-select, compare, navigate folders, and open/close settings. Require visible focus and named controls.
2. Implement C7 roving focus by stable item key, using the actual grid column count and Virtuoso scroll APIs to focus unmounted targets after rendering. Reconcile focus after refresh/removal and avoid trapping Tab inside the grid.
3. Use semantic buttons/controls where practical and correct list/grid/tree semantics elsewhere. Label the selection control and expose selected/expanded states. Do not nest interactive elements invalidly or intercept normal text-field keys.
4. Centralize topmost overlay/dialog focus and Escape handling. Narrow preview overlay and settings get appropriate modal behavior, focus containment, and focus restoration; docked preview remains nonmodal. Escape in an editing dialog does not close the underlying preview.
5. Add live announcements for result/selection changes and errors at a coalesced rate. Preserve modifier-click and drag behavior for regular files; make archive summary selection policy explicit.

**Acceptance:** Core browse/preview/tag/selection/folder/settings actions are possible without a pointer. Focus survives virtualization, paging, close, and deletion. Exactly one active layer consumes Escape.

**Verify:** Type, navigation Unit, Product keyboard flows and accessibility-state assertions. Record a manual screen-reader spot check if available; do not claim comprehensive accessibility certification from DOM assertions.

## U05 - Present useful progress and respect watcher preferences

**Priority:** P2. **Dependencies:** U02, S06, T04. **Owner:** U.

**Own:** `App.tsx`, `ScanProgress.tsx`, `Sidebar.tsx`, `styles.css`; new `src/renderer/hooks/useBackgroundJobs.ts`, background UI reducer tests, and `tests/product/e2e/background-work.e2e.ts`.

**Steps:**

1. Add flows for scan while browsing, partial/offline root, pause/resume/cancel, targeted retry, thumbnail failures, and two jobs completing close together. Add the watch-disabled-then-rescan regression.
2. Subscribe to first/batched indexed-file events so new records appear before scan completion. Use U02's coalescing and retain browse scope/scroll when events arrive. Do not fetch every summary per indexed file.
3. Show discovery, indexed files, and thumbnail outcomes separately; use indeterminate discovery progress until its total is known. Show clear retained/offline/failed status and an action appropriate to it. Keep details expandable so background work does not dominate the library.
4. Wire Pause/Resume/Cancel/Retry failures to typed job IDs and valid states, with disabled/pending controls during transitions. Do not label processed failures as generated thumbnails. Replace unscoped two-second hide timers with job-identity-aware terminal presentation.
5. Make watch enablement one effect/owner depending on roots and watcher-relevant settings only. Remove unconditional startWatching from scan completion. Toggling watch off stops it; changing page size, preview/thumbnail color, or sorting does not restart it.
6. Use focused error messages and retry controls; retain the last completed/partial summary until dismissed or superseded by the same scope's new job. Keep all existing files visible when a root is offline.

**Acceptance:** The first discovered batch is visible during ongoing work. Controls operate the indicated job; old completion events never hide a new job. Watch stays disabled through rescan, and irrelevant preferences do not restart it. Failures/offline roots are actionable without pretending the library is empty.

**Verify:** Type, renderer Unit, Product with real job IPC and watcher process. Include rapid consecutive scans and recovery after reconnect.

## U06 - Integrate slicer, backup/restore, and honest measurements

**Priority:** P2 product. **Dependencies:** U04, P01, P02, P04, S04. **Owner:** U.

**Own:** `App.tsx`, `SettingsModal.tsx`, `ComparePanel.tsx`, `styles.css`, `src/renderer/lib/formatters.ts`; new `SlicerSettings.tsx`, `MetadataBackupPanel.tsx`, shared presentation tests, and `tests/product/e2e/product-workflows.e2e.ts`. V adds PreviewPanel actions/measurement formatting; coordinator wires native context-menu actions in `src/main/ipc/system.ts`.

**Steps:**

1. Add an explicit Open in slicer action for indexed models, including archive members, and a settings control to choose the application/default fallback. Archive summaries first require choosing a member. Surface preparing/opened/failed states and prevent accidental double launch. Calls use P01's service; UI never composes shell commands.
2. Add metadata export and import-preview entry points with clear "source models are not included" copy. Show affected counts, unmatched/pending records, conflicts, and unchecked settings/root replacement choices. Require the user's explicit Apply action for the concrete preview; native dialog cancellation is a no-op.
3. Implement P04's localStorage prepare/apply/ack flow and startup reconciliation before scan/watch startup. Disable conflicting annotation/collection/settings edits only during the short commit, retain user feedback, and show recoverable failure state until both stores agree.
4. Present pending restore annotations and a Retry matching action after indexing. Make conflict policy visible; preserved existing notes/status are not silently reported as overwritten/restored. Provide the recovery-backup location/action returned by the service.
5. Use one dimension formatter in preview and compare: verified source-build mm for supported 3MF, model units for STL/OBJ, and explicit unverified/unavailable states. Rename byte-based "Volume" to "File size". Do not reuse display-normalized geometry size as physical dimensions.
6. Apply U04's focus/keyboard rules to the new controls and dialogs. Keep native executable paths and parser/transport details out of ordinary model flows except the chosen app's understandable name.

**Acceptance:** A model can be explicitly handed off, an archived member is safely prepared, and failures are actionable. Export/import round-trip annotations and collections; cancel leaves state unchanged and interrupted restore recovers. Measurement labels cannot imply trusted millimeters for unitless files or volume for bytes.

**Verify:** Type, Unit for presentation/state transitions, Build, Product with mocked native launch/save/open dialogs and isolated data. Include malformed backup, conflicts, unmatched paths, startup recovery, archive handoff, and focus return.
