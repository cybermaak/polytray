<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="Polytray icon" />
</p>

# Polytray

<p>
  Local-first desktop organizer for large <code>.stl</code>, <code>.obj</code>, and <code>.3mf</code> libraries. Scan folders, generate thumbnails, search fast, and inspect models in a responsive Three.js preview without sending your files to the cloud.
</p>

<p>
  <a href="https://github.com/cybermaak/polytray/releases/tag/v1.1.0"><strong>Download v1.1.0</strong></a>
  ·
  <a href="https://github.com/cybermaak/polytray/releases/tag/v1.1.0">Release Notes</a>
  ·
  <a href="#development">Development</a>
</p>

[![GitHub Release](https://img.shields.io/github/v/release/cybermaak/polytray?style=flat-square)](https://github.com/cybermaak/polytray/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/cybermaak/polytray/build.yml?branch=main&style=flat-square)](https://github.com/cybermaak/polytray/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)

## Visual Tour

<p align="center">
  <img src="docs/assets/polytray_demo.webp" alt="Animated demo of Polytray browsing, previewing, and opening settings" width="960" />
</p>

![Polytray v1.1.0 screenshot](docs/assets/screenshot.png)

## Why Polytray

- Fast local indexing for dense model folders, with background thumbnail generation and no cloud dependency.
- Responsive preview pipeline for `STL`, `OBJ`, and `3MF`, including large-model handling and multi-model `3MF` support.
- Practical browsing workflow: folder tree, search, sort, format filters, context strip, and preview-on-select.
- Desktop-native integration for drag-out, reveal-in-Finder/Explorer, and context menus.
- User-tunable appearance controls for accent color, preview material color, and thumbnail material color.

## What's New in v1.1.0

- Reduced UI stalls during large preview loads, including the heavy `3MF` path.
- Unified the preview architecture so format-specific parsing stays in the background while the interactive viewer remains consistent.
- Polished the shell with cleaner preview framing, stronger card states, revised toolbar context, and improved iconography.
- Split appearance settings into separate accent, preview, and thumbnail colors, each with reset support.
- Hardened runtime behavior with queue control, IPC validation, migration coverage, and cache lifecycle work.

## Core Workflow

1. Add one or more library folders from the sidebar.
2. Let Polytray scan, index, and generate thumbnails in the background.
3. Narrow the library with folder scope, search, sort, and format filters.
4. Click a card to open the preview, inspect the mesh, toggle wireframe, and reset the camera.
5. Drag the source file into your slicer or use the context menu to reveal it in the OS.

## Development

Polytray is built with Electron, React, Vite, Better-SQLite3, and Three.js.

### Setup

```bash
git clone https://github.com/cybermaak/polytray.git
cd polytray
npm install
```

### Common Commands

```bash
npm run dev       # Electron + Vite development mode
npm run build     # Typecheck and build production bundles
npm run test:e2e  # Generate fixtures and run Playwright coverage
npm run build:mac
npm run build:win
npm run build:linux
```

### Release Media

The README screenshot and animated demo can be regenerated from the live app with:

```bash
node scripts/capture-readme-media.mjs
```

## Status

- Supported formats: `STL`, `OBJ`, `3MF`
- Storage model: local SQLite index, local thumbnail cache, renderer-owned app settings and library state
- Privacy model: local-first; Polytray does not require cloud storage or remote processing
- Release flow: GitHub Actions builds and publishes platform artifacts from tagged releases
