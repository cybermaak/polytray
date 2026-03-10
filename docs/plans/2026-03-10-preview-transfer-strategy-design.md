# Preview Transfer Strategy Design

## Goal

Reduce `3MF` interactive preview latency without regressing orientation, preview correctness, or the unified preview API used by the visible renderer.

## Constraints

- `ThreeMFLoader` and local `3MF` repair depend on DOM APIs such as `DOMParser`.
- Those APIs are not available in the plain renderer `Worker` currently used for `STL` and `OBJ`.
- The visible renderer must still receive mesh data to support interactive camera/orbit controls.

## Chosen Design

- Keep one public preview-loading flow in the visible renderer.
- Select a parse strategy by file format.
- Keep `STL`/`OBJ` on the existing worker strategy.
- Keep `3MF` parsing inside the hidden thumbnail renderer process.
- Replace the previous invoke/response clone path for `3MF` with a direct renderer-to-renderer `MessagePort` transfer brokered by the main process.

## Why

- Preserves a unified architecture at the preview API level.
- Allows format-specific middle-stage implementations.
- Avoids forcing DOM-dependent `3MF` parsing into the worker.
- Reduces large structured-clone copies through main-process IPC by using transferable buffers over a direct port.

## Data Flow

1. Visible renderer requests preview parse with `requestId`, file path, and extension.
2. Main process creates a `MessageChannelMain`.
3. Main process transfers one port to the visible renderer and one port to the hidden thumbnail renderer.
4. Hidden renderer parses the file and posts serialized mesh payloads over the port using transferable `ArrayBuffer`s.
5. Visible renderer resolves the preview promise and rebuilds meshes through the shared viewer build path.

## Validation

- `base.3mf` responsiveness regression remains the primary real-world validation case.
- Existing large-model STL responsiveness test remains the non-`3MF` safety net.
- Orientation parity is validated against cached thumbnails and model-specific regressions such as `button box.3mf`.
