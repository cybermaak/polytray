/**
 * app.js — Main renderer entry point
 *
 * Orchestrates UI interactions, IPC event handling, file browsing,
 * scanning progress, thumbnail updates, and the 3D viewer panel.
 */

import { createFileCard } from "./fileCard.js";
import {
  initViewer,
  loadModel,
  disposeViewer,
  toggleWireframe,
  resetCamera,
} from "./viewer.js";
import { initThumbnailGenerator } from "./thumbnailRenderer.js";

// ── Application State ─────────────────────────────────────────────

const state = {
  libraryFolders: [],
  files: [],
  total: 0,
  sort: "name",
  order: "ASC",
  extension: null,
  search: "",
  isScanning: false,
  isGeneratingThumbnails: false,
};

// ── DOM References ────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const dom = {
  // Sidebar
  btnSelectFolder: $("#btn-select-folder"),
  libraryFoldersList: $("#library-folders"),

  // Toolbar
  searchInput: $("#search-input"),
  searchClear: $("#search-clear"),
  sortSelect: $("#sort-select"),
  sortOrderBtn: $("#sort-order"),
  btnRescan: $("#btn-rescan"),
  btnClearThumbnails: $("#btn-clear-thumbnails"),
  btnSettings: $("#btn-settings"),
  btnThemeToggle: $("#btn-theme-toggle"),
  filterButtons: document.querySelectorAll(".filter-btn"),

  // Content
  fileGrid: $("#file-grid"),
  emptyState: $("#empty-state"),

  // Progress
  scanProgress: $("#scan-progress"),
  progressFill: $("#progress-fill"),
  progressText: $("#progress-text"),
  progressCount: $("#progress-count"),

  // Preview panel
  previewPanel: $("#preview-panel"),
  viewerFilename: $("#viewer-filename"),
  viewerPath: $("#viewer-path"),
  viewerMeta: $("#viewer-meta"),
  viewerContainer: $("#viewer-container"),
  viewerLoading: $("#viewer-loading"),
  btnWireframe: $("#btn-wireframe"),
  btnResetCamera: $("#btn-reset-camera"),
  btnExpandViewer: $("#btn-expand-viewer"),
  btnCloseViewer: $("#btn-close-viewer"),

  // Stats
  statTotal: $("#stat-total"),
  statStl: $("#stat-stl"),
  statObj: $("#stat-obj"),
  stat3mf: $("#stat-3mf"),
  statSize: $("#stat-size"),

  // Settings
  settingsOverlay: $("#settings-overlay"),
  settingsClose: $("#settings-close"),
  settingLightMode: $("#setting-light-mode"),
  settingGridSize: $("#setting-grid-size"),
};

// ── Initialization ────────────────────────────────────────────────

async function init() {
  initThumbnailGenerator();
  bindEvents();
  loadSettings();

  // Restore library folders
  state.libraryFolders = await window.polytray.getLibraryFolders();
  renderLibraryFolders();

  if (state.libraryFolders.length > 0) {
    await loadFiles();
    await updateStats();
    for (const folder of state.libraryFolders) {
      window.polytray.startWatching(folder);
    }
  }

  // IPC event listeners
  window.polytray.onScanProgress(handleScanProgress);
  window.polytray.onScanComplete(handleScanComplete);
  window.polytray.onFilesUpdated(handleFilesUpdated);
  window.polytray.onThumbnailReady(handleThumbnailReady);
  window.polytray.onThumbnailProgress(handleThumbnailProgress);
}

// ── Event Bindings ────────────────────────────────────────────────

function bindEvents() {
  dom.btnSelectFolder.addEventListener("click", handleSelectFolder);

  // Search (debounced)
  let searchTimeout;
  dom.searchInput.addEventListener("input", () => {
    state.search = dom.searchInput.value.trim();
    dom.searchClear.classList.toggle("hidden", !state.search);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadFiles(), 200);
  });
  dom.searchClear.addEventListener("click", () => {
    dom.searchInput.value = "";
    state.search = "";
    dom.searchClear.classList.add("hidden");
    loadFiles();
  });

  // Sort
  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    loadFiles();
  });
  dom.sortOrderBtn.addEventListener("click", () => {
    state.order = state.order === "ASC" ? "DESC" : "ASC";
    dom.sortOrderBtn.classList.toggle("desc", state.order === "DESC");
    loadFiles();
  });

  // Format filter
  dom.filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      dom.filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.extension = btn.dataset.ext || null;
      loadFiles();
    });
  });

  // Rescan
  dom.btnRescan.addEventListener("click", handleRescanAll);

  // Regenerate thumbnails
  dom.btnClearThumbnails.addEventListener("click", async () => {
    if (confirm("Regenerate all thumbnails? This may take a while.")) {
      await window.polytray.clearThumbnails();
      await handleRescanAll();
    }
  });

  // Viewer controls
  dom.btnWireframe.addEventListener("click", () => {
    dom.btnWireframe.classList.toggle("active");
    toggleWireframe();
  });
  dom.btnResetCamera.addEventListener("click", resetCamera);
  dom.btnExpandViewer.addEventListener("click", () => {
    dom.previewPanel.classList.toggle("expanded");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
  });
  dom.btnCloseViewer.addEventListener("click", closeViewer);

  // Theme toggle (toolbar quick-toggle)
  dom.btnThemeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light");
    dom.settingLightMode.checked = isLight;
    saveSettings();
  });

  // Settings modal
  dom.btnSettings.addEventListener("click", openSettings);
  dom.settingsClose.addEventListener("click", closeSettings);
  dom.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === dom.settingsOverlay) closeSettings();
  });

  // Settings changes
  dom.settingLightMode.addEventListener("change", () => {
    document.body.classList.toggle("light", dom.settingLightMode.checked);
    saveSettings();
  });
  dom.settingGridSize.addEventListener("change", () => {
    applyGridSize(dom.settingGridSize.value);
    saveSettings();
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!dom.settingsOverlay.classList.contains("hidden")) {
        closeSettings();
      } else if (!dom.previewPanel.classList.contains("hidden")) {
        if (dom.previewPanel.classList.contains("expanded")) {
          dom.previewPanel.classList.remove("expanded");
          setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
        } else {
          closeViewer();
        }
      }
    }
  });
}

// ── Settings ──────────────────────────────────────────────────────

function openSettings() {
  dom.settingsOverlay.classList.remove("hidden");
}

function closeSettings() {
  dom.settingsOverlay.classList.add("hidden");
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("polytray-settings");
    if (!raw) return;
    const s = JSON.parse(raw);

    if (s.lightMode) {
      document.body.classList.add("light");
      dom.settingLightMode.checked = true;
    }
    if (s.gridSize) {
      dom.settingGridSize.value = s.gridSize;
      applyGridSize(s.gridSize);
    }
  } catch (e) {
    // Ignore corrupt settings
  }
}

function saveSettings() {
  const s = {
    lightMode: dom.settingLightMode.checked,
    gridSize: dom.settingGridSize.value,
  };
  localStorage.setItem("polytray-settings", JSON.stringify(s));
}

function applyGridSize(size) {
  const grid = dom.fileGrid;
  switch (size) {
    case "small":
      grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(160px, 1fr))";
      break;
    case "large":
      grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(260px, 1fr))";
      break;
    default:
      grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(200px, 1fr))";
  }
}

// ── Library Folder Management ─────────────────────────────────────

async function handleSelectFolder() {
  const folder = await window.polytray.selectFolder();
  if (!folder) return;

  state.libraryFolders = await window.polytray.getLibraryFolders();
  renderLibraryFolders();
  await startScan(folder);
}

async function handleRemoveFolder(folderPath) {
  state.libraryFolders = await window.polytray.removeLibraryFolder(folderPath);
  renderLibraryFolders();
  await loadFiles();
  await updateStats();
}

function renderLibraryFolders() {
  dom.libraryFoldersList.innerHTML = "";

  for (const folder of state.libraryFolders) {
    const li = document.createElement("li");
    li.className = "library-folder-item";

    const icon = document.createElement("span");
    icon.textContent = "📁";
    icon.style.fontSize = "12px";
    li.appendChild(icon);

    const name = document.createElement("span");
    name.className = "library-folder-name";
    const parts = folder.split("/");
    name.textContent = parts[parts.length - 1] || folder;
    name.title = folder;
    li.appendChild(name);

    const removeBtn = document.createElement("button");
    removeBtn.className = "library-folder-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove from library";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleRemoveFolder(folder);
    });
    li.appendChild(removeBtn);

    dom.libraryFoldersList.appendChild(li);
  }
}

// ── Scanning ──────────────────────────────────────────────────────

async function handleRescanAll() {
  for (const folder of state.libraryFolders) {
    await startScan(folder);
  }
}

async function startScan(folder) {
  state.isScanning = true;
  dom.scanProgress.classList.remove("hidden");
  dom.progressFill.style.width = "0%";
  dom.progressText.textContent = "Starting scan...";
  dom.progressCount.textContent = "";

  try {
    await window.polytray.scanFolder(folder);
  } catch (e) {
    console.error("Scan failed:", e);
  }
}

function handleScanProgress(data) {
  const pct = Math.round((data.current / data.total) * 100);
  dom.progressFill.style.width = `${pct}%`;
  dom.progressText.textContent =
    data.filename + (data.skipped ? " (cached)" : "");
  dom.progressCount.textContent = `${data.current} / ${data.total}`;
}

async function handleScanComplete(data) {
  state.isScanning = false;
  dom.progressFill.style.width = "100%";
  dom.progressText.textContent = `Scan complete — ${data.totalFiles} files`;

  setTimeout(() => {
    if (!state.isGeneratingThumbnails) {
      dom.scanProgress.classList.add("hidden");
    }
  }, 2000);

  await loadFiles();
  await updateStats();

  for (const folder of state.libraryFolders) {
    window.polytray.startWatching(folder);
  }
}

// ── Thumbnail Progress ────────────────────────────────────────────

function handleThumbnailProgress(data) {
  const { current, total, filename, phase } = data;

  if (phase === "start") {
    state.isGeneratingThumbnails = true;
    dom.scanProgress.classList.remove("hidden");
    dom.progressFill.style.width = "0%";
    dom.progressText.textContent = "Generating thumbnails...";
    dom.progressCount.textContent = `0 / ${total}`;
    return;
  }

  if (phase === "done") {
    state.isGeneratingThumbnails = false;
    dom.progressFill.style.width = "100%";
    dom.progressText.textContent = `Thumbnails complete — ${total} generated`;
    dom.progressCount.textContent = `${total} / ${total}`;
    setTimeout(() => {
      dom.scanProgress.classList.add("hidden");
    }, 2000);
    return;
  }

  const pct = Math.round((current / total) * 100);
  dom.progressFill.style.width = `${pct}%`;
  dom.progressText.textContent = `Thumbnail: ${filename}`;
  dom.progressCount.textContent = `${current} / ${total}`;
}

async function handleFilesUpdated() {
  await loadFiles();
  await updateStats();
}

async function handleThumbnailReady(data) {
  const { fileId, thumbnailPath } = data;
  const card = dom.fileGrid.querySelector(
    `.file-card[data-file-id="${fileId}"]`,
  );
  if (!card) return;

  const thumbDiv = card.querySelector(".card-thumbnail");
  if (!thumbDiv) return;

  const dataUrl = await window.polytray.readThumbnail(thumbnailPath);
  if (!dataUrl) return;

  // Remove loading pulse
  const pulse = thumbDiv.querySelector(".thumbnail-pulse");
  if (pulse) pulse.remove();

  const placeholder = thumbDiv.querySelector(".placeholder-icon");

  const img = document.createElement("img");
  img.alt = "thumbnail";
  img.style.opacity = "0";
  img.style.transition = "opacity 0.3s ease";
  img.src = dataUrl;
  img.onload = () => {
    img.style.opacity = "1";
    if (placeholder) placeholder.remove();
  };
  thumbDiv.insertBefore(img, thumbDiv.querySelector(".card-ext-badge"));
}

// ── File Loading ──────────────────────────────────────────────────

async function loadFiles() {
  const result = await window.polytray.getFiles({
    sort: state.sort,
    order: state.order,
    extension: state.extension,
    search: state.search,
    limit: 500,
    offset: 0,
  });

  state.files = result.files;
  state.total = result.total;
  renderFileGrid();
}

function renderFileGrid() {
  dom.fileGrid.innerHTML = "";

  if (state.files.length === 0) {
    dom.fileGrid.style.display = "none";
    dom.emptyState.classList.remove("hidden");
    return;
  }

  dom.fileGrid.style.display = "grid";
  dom.emptyState.classList.add("hidden");

  state.files.forEach((file, index) => {
    const card = createFileCard(file, index);
    card.addEventListener("click", () => openViewer(file));
    dom.fileGrid.appendChild(card);
  });
}

// ── Stats ─────────────────────────────────────────────────────────

async function updateStats() {
  const stats = await window.polytray.getStats();
  dom.statTotal.textContent = stats.total;
  dom.statStl.textContent = stats.stl;
  dom.statObj.textContent = stats.obj;
  dom.stat3mf.textContent = stats.threemf;
  dom.statSize.textContent = formatSize(stats.totalSize);
}

// ── 3D Viewer ─────────────────────────────────────────────────────

async function openViewer(file) {
  dom.previewPanel.classList.remove("hidden");
  dom.previewPanel.classList.remove("expanded");
  dom.viewerLoading.classList.remove("hidden");
  dom.btnWireframe.classList.remove("active");

  // Set filename and metadata
  dom.viewerFilename.textContent = `${file.name}.${file.extension}`;
  dom.viewerPath.textContent = file.directory || "";
  dom.viewerPath.title = file.path || "";
  dom.viewerMeta.textContent = `${formatNumber(file.vertex_count)} vertices · ${formatNumber(file.face_count)} faces · ${formatSize(file.size_bytes)} · ${file.extension.toUpperCase()}`;

  setTimeout(() => window.dispatchEvent(new Event("resize")), 50);

  // Reset loading UI
  dom.viewerLoading.querySelector("span").textContent = "Loading model...";
  const spinner = dom.viewerLoading.querySelector(".spinner");
  if (spinner) spinner.style.display = "block";

  try {
    initViewer(dom.viewerContainer);
    const buffer = await window.polytray.readFileBuffer(file.path);
    await loadModel(buffer, file.extension, file.name);
    dom.viewerLoading.classList.add("hidden");
  } catch (e) {
    console.error("Failed to load model:", e);
    dom.viewerLoading.querySelector("span").textContent =
      "Failed to load model file";
    if (spinner) spinner.style.display = "none";
  }
}

function closeViewer() {
  dom.previewPanel.classList.add("hidden");
  dom.previewPanel.classList.remove("expanded");
  disposeViewer();
}

// ── Utilities ─────────────────────────────────────────────────────

export function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

export function formatNumber(n) {
  if (!n) return "0";
  return n.toLocaleString();
}

// ── Boot ──────────────────────────────────────────────────────────
init();
