import { createFileCard } from "./fileCard.js";
import {
  initViewer,
  loadModel,
  disposeViewer,
  toggleWireframe,
  resetCamera,
} from "./viewer.js";
import { initThumbnailGenerator } from "./thumbnailRenderer.js";

// ── State ─────────────────────────────────────────────────────────
const state = {
  libraryFolders: [],
  files: [],
  total: 0,
  sort: "name",
  order: "ASC",
  extension: null,
  search: "",
  isScanning: false,
};

// ── DOM Elements ──────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const btnSelectFolder = $("#btn-select-folder");
const libraryFoldersList = $("#library-folders");
const searchInput = $("#search-input");
const searchClear = $("#search-clear");
const sortSelect = $("#sort-select");
const sortOrderBtn = $("#sort-order");
const btnRescan = $("#btn-rescan");
const fileGrid = $("#file-grid");
const emptyState = $("#empty-state");
const scanProgress = $("#scan-progress");
const progressFill = $("#progress-fill");
const progressText = $("#progress-text");
const progressCount = $("#progress-count");
const viewerModal = $("#viewer-modal");
const viewerFilename = $("#viewer-filename");
const viewerMeta = $("#viewer-meta");
const viewerContainer = $("#viewer-container");
const viewerLoading = $("#viewer-loading");
const btnWireframe = $("#btn-wireframe");
const btnResetCamera = $("#btn-reset-camera");
const btnCloseViewer = $("#btn-close-viewer");
const filterButtons = document.querySelectorAll(".filter-btn");

// Stats
const statTotal = $("#stat-total");
const statStl = $("#stat-stl");
const statObj = $("#stat-obj");
const stat3mf = $("#stat-3mf");
const statSize = $("#stat-size");

// ── Initialization ────────────────────────────────────────────────

async function init() {
  initThumbnailGenerator();
  bindEvents();

  // Restore library folders
  state.libraryFolders = await window.polytray.getLibraryFolders();
  renderLibraryFolders();

  if (state.libraryFolders.length > 0) {
    await loadFiles();
    await updateStats();
    // Watch all library folders
    for (const folder of state.libraryFolders) {
      window.polytray.startWatching(folder);
    }
  }

  // Listen for IPC events
  window.polytray.onScanProgress(handleScanProgress);
  window.polytray.onScanComplete(handleScanComplete);
  window.polytray.onFilesUpdated(handleFilesUpdated);
}

// ── Event Bindings ────────────────────────────────────────────────

function bindEvents() {
  btnSelectFolder.addEventListener("click", handleSelectFolder);

  // Search
  let searchTimeout;
  searchInput.addEventListener("input", () => {
    state.search = searchInput.value.trim();
    searchClear.classList.toggle("hidden", !state.search);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadFiles(), 200);
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    state.search = "";
    searchClear.classList.add("hidden");
    loadFiles();
  });

  // Sort
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    loadFiles();
  });
  sortOrderBtn.addEventListener("click", () => {
    state.order = state.order === "ASC" ? "DESC" : "ASC";
    sortOrderBtn.classList.toggle("desc", state.order === "DESC");
    loadFiles();
  });

  // Filter buttons
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.extension = btn.dataset.ext || null;
      loadFiles();
    });
  });

  // Rescan
  btnRescan.addEventListener("click", handleRescanAll);

  // Viewer controls
  btnWireframe.addEventListener("click", () => {
    btnWireframe.classList.toggle("active");
    toggleWireframe();
  });
  btnResetCamera.addEventListener("click", resetCamera);
  btnCloseViewer.addEventListener("click", closeViewer);

  // ESC to close viewer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !viewerModal.classList.contains("hidden")) {
      closeViewer();
    }
  });
}

// ── Library Folder Management ─────────────────────────────────────

async function handleSelectFolder() {
  const folder = await window.polytray.selectFolder();
  if (!folder) return;

  // Refresh library folders list
  state.libraryFolders = await window.polytray.getLibraryFolders();
  renderLibraryFolders();

  // Scan the new folder
  await startScan(folder);
}

async function handleRemoveFolder(folderPath) {
  state.libraryFolders = await window.polytray.removeLibraryFolder(folderPath);
  renderLibraryFolders();
  await loadFiles();
  await updateStats();
}

function renderLibraryFolders() {
  libraryFoldersList.innerHTML = "";

  for (const folder of state.libraryFolders) {
    const li = document.createElement("li");
    li.className = "library-folder-item";

    const icon = document.createElement("span");
    icon.textContent = "📁";
    icon.style.fontSize = "12px";
    li.appendChild(icon);

    const name = document.createElement("span");
    name.className = "library-folder-name";
    // Show just the last folder name
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

    libraryFoldersList.appendChild(li);
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
  scanProgress.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressText.textContent = "Starting scan...";
  progressCount.textContent = "";

  try {
    await window.polytray.scanFolder(folder);
  } catch (e) {
    console.error("Scan failed:", e);
  }
}

function handleScanProgress(data) {
  const pct = Math.round((data.current / data.total) * 100);
  progressFill.style.width = `${pct}%`;
  progressText.textContent = data.filename + (data.skipped ? " (cached)" : "");
  progressCount.textContent = `${data.current} / ${data.total}`;
}

async function handleScanComplete(data) {
  state.isScanning = false;
  progressFill.style.width = "100%";
  progressText.textContent = `Scan complete — ${data.totalFiles} files`;

  setTimeout(() => {
    scanProgress.classList.add("hidden");
  }, 2000);

  await loadFiles();
  await updateStats();

  // Watch all library folders
  for (const folder of state.libraryFolders) {
    window.polytray.startWatching(folder);
  }
}

async function handleFilesUpdated() {
  await loadFiles();
  await updateStats();
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
  fileGrid.innerHTML = "";

  if (state.files.length === 0) {
    fileGrid.style.display = "none";
    emptyState.classList.remove("hidden");
    return;
  }

  fileGrid.style.display = "grid";
  emptyState.classList.add("hidden");

  state.files.forEach((file, index) => {
    const card = createFileCard(file, index);
    card.addEventListener("click", () => openViewer(file));
    fileGrid.appendChild(card);
  });
}

// ── Stats ─────────────────────────────────────────────────────────

async function updateStats() {
  const stats = await window.polytray.getStats();
  statTotal.textContent = stats.total;
  statStl.textContent = stats.stl;
  statObj.textContent = stats.obj;
  stat3mf.textContent = stats.threemf;
  statSize.textContent = formatSize(stats.totalSize);
}

// ── 3D Viewer ─────────────────────────────────────────────────────

async function openViewer(file) {
  viewerModal.classList.remove("hidden");
  viewerLoading.classList.remove("hidden");
  btnWireframe.classList.remove("active");

  viewerFilename.textContent = `${file.name}.${file.extension}`;
  viewerMeta.textContent = `${formatNumber(file.vertex_count)} vertices · ${formatNumber(file.face_count)} faces · ${formatSize(file.size_bytes)} · ${file.extension.toUpperCase()}`;

  try {
    initViewer(viewerContainer);
    const buffer = await window.polytray.readFileBuffer(file.path);
    await loadModel(buffer, file.extension, file.name);
    viewerLoading.classList.add("hidden");
  } catch (e) {
    console.error("Failed to load model:", e);
    viewerLoading.querySelector("span").textContent = "Failed to load model";
  }
}

function closeViewer() {
  viewerModal.classList.add("hidden");
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
