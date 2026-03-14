# Preview Transfer Reduction Design

Date: 2026-03-13

## Goal

Reduce preview-load transfer overhead without breaking the unified preview architecture, orientation parity, or multi-model behavior.

## Current State

- `STL` and `OBJ` preview parsing already run in a dedicated renderer worker.
- `3MF` preview parsing runs in the hidden thumbnail renderer because `ThreeMFLoader` and `fix3MF()` require DOM APIs.
- Both paths converged on the same serialized mesh payload, which currently included every geometry attribute present on the source meshes.

## Problem

The interactive viewer only needs enough geometry data to rebuild lit preview meshes:

- `position`
- `normal`
- `index`
- mesh name

Sending extra attributes such as `uv`, `color`, or tangents increases transfer size and rebuild cost without improving the current preview experience.

## Chosen Approach

Introduce a preview-specific serialization profile while keeping the existing unified preview loading contract:

- add `serializePreviewGeometry()` to keep only preview-required attributes
- add `collectSerializedPreviewMeshes()` for preview transport paths
- switch both the worker strategy and hidden-renderer strategy to the compact preview serializer
- leave the viewer-facing `SerializedMesh[]` contract unchanged so the visible renderer rebuild path stays unified

## Why This Approach

- avoids adding a format-specific hack just for `3MF`
- reduces payload size for all preview formats
- keeps thumbnail behavior separate from preview behavior
- preserves baked world transforms and mesh names, so orientation and multi-model strip behavior remain intact

## Risks and Guards

- Risk: dropping attributes needed for shading
  - Guard: retain normals and keep the viewer fallback that computes normals if they are absent
- Risk: orientation regressions
  - Guard: keep world-transform baking in the preview serialization path and test it directly
- Risk: architecture drift
  - Guard: both preview strategies now use the same compact serializer profile

## Validation

- renderer unit test verifies compact preview serialization drops non-preview attributes while preserving normals and indices
- renderer unit test verifies world transforms are baked into serialized positions
- full product unit suite and typecheck must stay green
