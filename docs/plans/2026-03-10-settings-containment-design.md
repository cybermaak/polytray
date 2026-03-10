# Settings And Containment Design

## Goal

Address two correctness issues together:

1. Replace raw path-prefix folder matching with canonical subtree containment.
2. Make renderer-owned `localStorage` the single source of truth for user settings.

## Folder Containment

### Problem

Several main-process paths used `LIKE '${folder}%'` or similar prefix logic. That treats sibling prefixes as descendants, so `/foo/bar2` can be matched when the intended scope is `/foo/bar`.

### Design

- Add a canonical containment helper based on `path.resolve()` + `path.relative()`.
- Use it anywhere folder-subtree ownership matters:
  - folder-filtered file queries
  - stale-file cleanup during scan
  - folder thumbnail refresh
  - library-folder removal
- Keep the helper pure and shared within main-process code.

### Tradeoff

Folder-filtered file queries now do exact containment filtering in JS after coarse DB retrieval instead of relying entirely on SQL `LIKE`. This is intentionally correctness-first.

## Settings Ownership

### Problem

Settings behavior was split across:

- inline renderer defaults
- ad-hoc `localStorage` parsing/writes
- SQLite-backed main-process reads

That created ambiguous ownership and made runtime behavior depend on whichever layer last wrote a value.

### Design

- Add one typed settings module with:
  - defaults
  - validation
  - numeric clamping
  - serialization helpers
  - runtime-settings projection for main-process consumers
- Persist user settings only in `localStorage`.
- Stop reading runtime knobs like thumbnail timeout, scan batch size, and watcher stability from SQLite.
- Pass validated runtime settings explicitly from renderer to main for:
  - scan
  - thumbnail refresh/clear
  - watcher startup

## Library State Ownership

### Goal

Move `libraryFolders` and `lastFolder` out of SQLite-backed settings as well so renderer persistence has one authoritative home.

### Design

- Add a dedicated renderer-owned `localStorage` schema for library state.
- Keep `selectFolder` as a dialog-only main IPC call; renderer decides whether and how to persist the returned folder.
- Keep `removeLibraryFolder` as a main-process data cleanup operation only.
- On boot, if local library state is absent, renderer performs a one-time migration by reading legacy `GET_LIBRARY_FOLDERS` / `GET_LAST_FOLDER` IPC values and immediately persists the normalized local copy.
- After migration, renderer owns add/remove folder persistence and watcher startup inputs.

## Validation

- Pure tests for containment helper behavior
- Pure tests for settings normalization/serialization
- Electron regression test for sibling-prefix folder filtering
