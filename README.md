<div style="text-align: center;"><img src="build/icon.png" width="128" height="128" align="top" /></div>

# <div style="text-align: center;">Polytray</div>

[![GitHub Release](https://img.shields.io/github/v/release/cybermaak/polytray?style=flat-square)](https://github.com/cybermaak/polytray/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/cybermaak/polytray/build.yml?branch=main&style=flat-square)](https://github.com/cybermaak/polytray/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**Polytray** is a fast, offline-first 3D file organizer designed to help you scan, index, search, and preview your `.obj`, `.stl`, and `.3mf` files effortlessly. Built for desktop, it provides a highly visual, snappy interface to manage large collections of 3D assets without relying on the cloud.

## 🚀 Features

- **Local File Scanning**: Quickly point Polytray to your directories and let it index thousands of 3D models.
- **Hardware-Accelerated Preview**: Built-in 3D viewer powered by Three.js to inspect models from any angle. Includes wireframe mode, auto-centering, and smart lighting.
- **Multi-Model Support**: Automatic sub-model extraction and viewport zooming for complex `.3mf` build plates.
- **Auto-Generated Thumbnails**: Renders beautiful, consistent thumbnails in the background and displays them in a virtualized, ultra-smooth grid.
- **Fast Search & Filtering**: Instantly search by name, sort by file size or date added, and independently toggle format visibility (`STL`, `OBJ`, `3MF`).
- **Native OS Integration**: Native drag-and-drop to pull models directly into your slicer tool, plus context menus to reveal items in Finder/Explorer.
- **Offline & Private**: Everything is processed and stored securely in a local SQLite database.

## 📸 Screenshots & Demo

<p align="center">
  <img src="docs/assets/polytray_demo.webp" alt="Polytray Demo" width="800" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
</p>

![Polytray Preview Snapshot](docs/assets/screenshot.png)

## 💻 Usage

1. **Launch Polytray**: Open the downloaded application for your platform (macOS, Windows, or Linux).
2. **Add Folders**: Click **Add Folder** in the sidebar to select directories containing your 3D models. Polytray will recursively scan and generate thumbnails automatically.
3. **Browse & Search**: Use the top search bar to find specific files, or use the format chips (`STL`, `OBJ`, `3MF`) to narrow down the view.
4. **Preview**: Click on any file card to open the right-side 3D preview panel. You can easily copy the absolute file path, toggle wireframes, and inspect file coordinates.
5. **Settings**: Use the settings menu at the bottom left to toggle between **Dark/Light** themes, adjust thumbnail sizing, and tweak auto-scanning behaviors.

## 🛠️ Development Instructions

Polytray is built using **Electron**, **React**, **Vite**, **Better-SQLite3**, and **Three.js**.

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- `npm` (or `yarn` / `pnpm`)

### Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/cybermaak/polytray.git
cd polytray
npm install
```

### Running Locally

Start the development server with hot-module reloading:

```bash
npm run dev
```

_(Note: The app runs un-compiled TypeScript directly during `dev` via `electron-vite`, ensuring an incredibly fast iteration cycle.)_

### Testing

Run the comprehensive end-to-end test suite (powered by Playwright):

```bash
npm run test:e2e
```

_This command auto-generates test fixtures (`.obj`, `.stl`) temporarily so you don't need real 3D models to verify the UI._

### Building for Production

Compile and package the application for your operating system:

```bash
# Build the JS bundles for production
npm run build

# Package for macOS (requires a macOS environment)
npm run build:mac

# Package for Windows
npm run build:win

# Package for Linux (AppImage)
npm run build:linux

# Package for all supported platforms simultaneously
npm run build:all
```
