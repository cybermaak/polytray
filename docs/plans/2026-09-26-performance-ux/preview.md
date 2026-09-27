# Preview and interaction-performance tasks

Read [contracts C2, C5, C6, C7](contracts.md), the [tracker](tracker.md), and the existing preview strategy/serialization design documents. Keep preview/thumbnail orientation and material parity. V owns viewer files and PreviewPanel; U owns CSS and App integration.

## V01 - Give each viewer a lifecycle and stop drawing when idle

**Priority:** P2 performance. **Dependencies:** F01, F02. **Owner:** V.

**Own:** `src/renderer/lib/viewer.ts`, `src/renderer/lib/cameraUtils.ts`; new `src/renderer/lib/viewerSession.ts`, renderer session tests, and `tests/product/e2e/viewer-idle.e2e.ts`. Coordinator changes only the visible-window throttling setting in main.

**Steps:**

1. Add a test that settles a cube then observes no further scheduled render frames in a quiet one-second interval. Separately sample WebGL draw calls so the test cannot confuse scene draw count with frame count.
2. Move global resource ownership behind an explicit session handle: renderer/scene/controls/model, load token, pending frame, resize/visibility subscriptions, and disposal. Preserve exports through an adapter while callers migrate.
3. Replace perpetual rAF with `invalidate()`. Request frames for camera/control changes, damped motion until settled, model/color/grid/wireframe/part changes, resize, and capture. Deduplicate requests so one state change cannot start parallel loops.
4. Pause visible-session scheduling on hide/minimize and invalidate once on return. Keep hidden thumbnail/preview runtimes eligible for background work. Ask the coordinator to restore normal background throttling only for the visible BrowserWindow.
5. Dispose all owned geometry/materials including grid/helpers, controls, observers/listeners, pending frames, and temporary render resources. Disposal is idempotent; old callbacks cannot touch a replacement session.

**Acceptance:** A settled preview uses zero continuing frames; orbit damping still settles smoothly; resize, theme/color/grid, capture, and restore all render current state. Opening/closing/reopening preview does not grow listener/frame/context counts.

**Verify:** Type, renderer Unit, Build, Product with visible/hidden/minimized checks where supported. Report frame measurements and platform limitations separately.

## V02 - Decouple metadata from geometry and show durable preview states

**Priority:** P2 correctness/UX. **Dependencies:** V01, D02. **Owner:** V.

**Own:** `src/renderer/components/PreviewPanel.tsx`; new `src/renderer/lib/previewState.ts`, `src/renderer/lib/archivePreviewPages.ts`; new unit tests and `tests/product/e2e/preview-state.e2e.ts`. U supplies PreviewTarget in App and requested CSS only.

**Steps:**

1. Add red tests: tag/note/collection edits and thumbnail arrival preserve canvas identity and camera pose; a failed parse leaves a visible error with Retry; rapid file changes never flash stale content. Include a failed retry and successful subsequent retry.
2. Initialize the viewer session for the mounted container. Load geometry only when its C5 identity changes. Use separate in-place updates for preview material color, grid, wireframe, and background. Do not depend on the whole mutable FileRecord or thumbnail-color setting for geometry loading.
3. Replace coupled loading/error booleans with explicit idle/loading/ready/error state keyed by load token. Render the error outside a container hidden when loading is false. Give Retry a new load token for the same identity; Close remains available throughout.
4. Implement C2 lazy archive entry pages in the preview, preserving existing archive navigation. Fetch neighboring pages only when needed; show correct matching-entry count and loading/error feedback for page fetches. Never require the full archive to be loaded before previewing its first file.
5. Forward topmost Escape/focus requests to U's overlay policy rather than installing an unconditional competing global handler. Keep text inputs editable. Request scoped CSS from U03/U04; do not edit their files concurrently.

**Acceptance:** Editing metadata causes zero parse requests and zero new WebGL contexts. A file content-revision change reloads once. Errors remain readable/retryable after loading stops. A multi-page archive can be navigated past its first page without incomplete counts or loading all members eagerly.

**Verify:** Type, Unit, Product with canvas identity/camera assertions, deliberate parser failure, and archive navigation beyond the page boundary. Preserve settings-grid state even when initialization is asynchronous.

## V03 - Cancel obsolete parsing through an owned preview runtime

**Priority:** P2 responsiveness/correctness. **Dependencies:** F01, F02, D01. **Owner:** V.

D01 supplies the actual persisted content revision used by preview requests. V03 may implement against that reviewed contract while D01 finishes integration, but its runtime gate and completion require verified D01. Thread `currentFile.content_revision` through the existing caller without substituting timestamps or broadening into V02's state refactor.

**Own:** `src/main/previewParseService.ts`, `src/preload/previewBridge.ts`, `src/renderer/lib/previewStrategies.ts`, extracted `previewParseRenderer.ts`; new `src/main/previewWindow.ts`, `src/renderer/preview.html`, `src/renderer/preview.ts`, broker tests, and `tests/product/e2e/preview-cancellation.e2e.ts`. Coordinator handles main registration/build entries and shared validation; T's window/service remains T-owned.

**Steps:**

1. Reproduce rapid A -> B -> C selection while a 3MF parse is deliberately held, then close the panel. Assert only C may publish and close cancels all work. Run thumbnail generation at the same time and require it to continue.
2. Introduce renderer-created request IDs and explicit IPC cancel. Bind requests and ports to their requesting webContents; register cancellation before dispatch so already-aborted signals cannot leak requests. Cover cancellation before port arrival and before renderer readiness.
3. Move preview parsing to one lazy dedicated DOM-capable hidden window. Queue only the latest replacement. Destroy/recreate that owned runtime to stop obsolete synchronous work, waiting for actual readiness before sending the next request. Verify cancellation stops old computation, not only UI publication.
4. Centralize settlement for success/error/cancel/timeout/requester-close/runtime-crash. Clear both preload and main maps, close both MessagePort ends, and remove abort/listener/timer state once. Ignore late unknown IDs without adopting their buffers.
5. Keep STL/OBJ worker termination wired to abort and extend cancellation through archive reads where feasible. Main archive-read cancellation uses request ownership and discards late buffers; no additional processing/mesh construction may run after cancellation. Do not transfer AbortSignal over contextBridge.
6. Retain lightweight eligibility and ThreeMFLoader/fix3MF DOM fallback. Add restart tests and a bounded failure response if the new preview window cannot start. Do not force-crash a renderer process shared with thumbnail work; validate the ownership boundary.

**Acceptance:** Old parse work stops within the C10 fixture target and loses publication rights immediately. No leaked ports/timers/listeners after rapid selection, close, timeout, or crash. Thumbnail progress remains independent. Unsupported 3MF still falls back correctly.

**Verify:** Type, Unit for broker transitions/ownership, Build, Product including isolated runtime crash/cancel and simultaneous thumbnail generation. Record process/resource cleanup evidence.

## V04 - Prepare orientation in the background and budget visible mesh assembly

**Priority:** P2 performance. **Dependencies:** V01, V03, S04. **Owner:** V.

**Own:** `src/renderer/lib/orientation.ts`, `src/renderer/lib/meshSerialization.ts`, `src/renderer/lib/modelParsers.ts`, `src/renderer/lib/workers/parser.worker.ts`, `src/renderer/lib/viewer.ts`, preview parse renderer; new shared pure preparation module and preparation/parity tests. T applies the small shared-preparation call change in its thumbnail renderer; S's shared 3MF measurement core is read-only after handoff unless coordinated.

**Steps:**

1. Add a dense single-mesh test and multipart transforms/indexed-geometry parity cases. Record visible CPU long tasks for the existing all-triangle orientation loop. Golden geometry assertions cover orientation, bounds, units, normals, and thumbnail/preview parity.
2. Compute the pure orientation result in the parse worker/hidden renderer and serialize the resulting transform/bounds with mesh data. Prepare expensive normals there as well. Apply each transform/unit conversion exactly once; return source-build measurements separately from display-normalized bounds.
3. Keep transferable ownership explicit. Do not read buffers after transfer or copy whole geometry simply to share a thumbnail path. Dispose parser geometries after serialization and keep the current compact attribute format unless a test proves additional data is necessary.
4. In visible assembly, use a time budget (initially 8 ms) plus a vertex budget. Handle a single large geometry by preparing costly attributes off-thread and chunking necessary CPU copies/assembly; yielding only every eight meshes is insufficient. Record unavoidable GPU upload cost separately.
5. Capture session/load token in every async stage and check it before/after each await and before scene mutation. If cancelled, dispose partial geometry/materials immediately and never access `state.scene` from a newer viewer.
6. Have T adopt the same pure orientation/preparation function and verify its rendered orientation. Respect S04's measurement unit semantics on both fast and fallback paths; unknown provenance remains unavailable rather than guessed.

**Acceptance:** No full-triangle orientation/normal loop remains in the visible renderer. Large single and multipart fixtures remain interactive within the recorded target, and cancellation cannot attach old geometry. Preview/thumbnail orientation and build transforms remain equivalent.

**Verify:** Type, Unit across serialization/preparation/measurement, Build, Product. Record CPU slice/long-task metrics and first-frame times for both dense and multipart portable fixtures; optionally repeat the real 3MF probe if available.

## V05 - Make part thumbnails small, progressive, and independent

**Priority:** P2 UX performance. **Dependencies:** V04. **Owner:** V.

**Own:** `src/renderer/lib/viewer.ts`; new `src/renderer/lib/partThumbnailQueue.ts`, `src/renderer/components/PreviewParts.tsx`; PreviewPanel integration and new part-thumbnail tests. U applies scoped CSS requests.

**Steps:**

1. Add a multipart fixture test proving the model's first usable frame/ready state occurs before all part images finish. Include replacing/closing the model halfway through image generation.
2. Remove full-viewer-canvas `toDataURL` and scene visibility toggling from the blocking load path. Resolve preview readiness after a usable model frame; show stable part-image placeholders meanwhile.
3. Render 128 x 128 part images with a separate small render target/renderer and independent camera. Request only visible and near-visible part cards, with a single bounded queue and cooperative yields. Avoid allocating one WebGL context per part.
4. Associate work with session/load token, cancel outdated items, and bound the image cache to visible/near-visible parts plus a small LRU (maximum 64 images). Revoke object URLs and dispose render resources on eviction/replacement/close.
5. Let React own the strip and accessible controls. Updating an image does not refit/reset the live camera, alter part visibility, or force the model to reload.

**Acceptance:** The preview is usable while images arrive. Multipart thumbnail work cannot change the user's camera or model state, and closing/replacing stops publication. Memory/resources do not grow across repeated multipart previews.

**Verify:** Type, Unit for queue cancellation/cache limits, Build, Product with ready-before-images ordering, camera preservation, and resource cleanup observations.
