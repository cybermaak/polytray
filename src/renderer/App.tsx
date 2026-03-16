/**
 * App.tsx — Root React component.
 *
 * Reproduces the exact same DOM structure and IDs as the original
 * vanilla index.html + app.js, ensuring CSS and E2E tests work unchanged.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { PreviewPanel } from "./components/PreviewPanel";
import { ComparePanel } from "./components/ComparePanel";
import { SettingsModal } from "./components/SettingsModal";
import { BatchActionsBar } from "./components/BatchActionsBar";
import { EmptyState } from "./components/EmptyState";
import { FileGrid } from "./components/FileGrid";
import { ScanProgress } from "./components/ScanProgress";
import { createRefreshDebouncer } from "./lib/refreshDebouncer";
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  serializeAppSettings,
  SETTINGS_STORAGE_KEY,
  toRuntimeSettings,
} from "../shared/settings";
import {
  DEFAULT_LIBRARY_STATE,
  LIBRARY_STATE_STORAGE_KEY,
  LibraryState,
  normalizeLibraryState,
  serializeLibraryState,
  withAddedLibraryFolder,
  withRemovedLibraryFolder,
} from "../shared/libraryState";
import {
  COLLECTIONS_STORAGE_KEY,
  DEFAULT_COLLECTIONS_STATE,
  type CollectionsState,
  normalizeCollectionsState,
  serializeCollectionsState,
  upsertCollection,
  removeCollection,
  addFilesToCollection,
} from "../shared/libraryCollections";
import { normalizeFileTags, parseStoredFileTags } from "../shared/fileTags";
import type { FileRecord } from "../shared/types";

interface LibraryStats {
  total: number;
  stl: number;
  obj: number;
  threemf: number;
  totalSize: number;
}

interface ProgressState {
  visible: boolean;
  percent: number;
  text: string;
  count: string;
}

export const App: React.FC = () => {
  // ── State ───────────────────────────────────────────────────────
  const [folders, setFolders] = useState<string[]>([]);
  const [stats, setStats] = useState<LibraryStats>({
    total: 0,
    stl: 0,
    obj: 0,
    threemf: 0,
    totalSize: 0,
  });
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState<"ASC" | "DESC">("ASC");
  const [extension, setExtension] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [comparisonFiles, setComparisonFiles] = useState<FileRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionsState, setCollectionsState] = useState<CollectionsState>(
    DEFAULT_COLLECTIONS_STATE,
  );
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [batchTagsInput, setBatchTagsInput] = useState("");
  const [batchCollectionId, setBatchCollectionId] = useState("");
  const [progress, setProgress] = useState<ProgressState>({
    visible: false,
    percent: 0,
    text: "",
    count: "",
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const activeFolderLabel = activeFolder
    ? activeFolder.split(/[\\/]/).filter(Boolean).pop() || activeFolder
    : null;
  const activeCollection = collectionsState.collections.find(
    (collection) => collection.id === collectionsState.activeCollectionId,
  ) || null;
  const activeCollectionLabel = activeCollection?.name || null;
  const selectedFiles = files.filter((file) => selectedFileIds.includes(file.id));
  const comparisonActive = comparisonFiles.length === 2;

  // Refs to get latest state in IPC callbacks
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const isGeneratingRef = useRef(false);
  const hasBooted = useRef(false);
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const orderRef = useRef(order);
  orderRef.current = order;
  const extensionRef = useRef(extension);
  extensionRef.current = extension;
  const activeFolderRef = useRef(activeFolder);
  activeFolderRef.current = activeFolder;
  const searchRef = useRef(search);
  searchRef.current = search;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const libraryStateRef = useRef<LibraryState>(DEFAULT_LIBRARY_STATE);
  const collectionsStateRef = useRef<CollectionsState>(DEFAULT_COLLECTIONS_STATE);
  const fileRefreshDebouncerRef = useRef<ReturnType<
    typeof createRefreshDebouncer
  > | null>(null);

  const applySettingsToDocument = useCallback((nextSettings: AppSettings) => {
    document.body.classList.toggle("light", nextSettings.lightMode);
    document.body.style.setProperty(
      "--accent-primary",
      nextSettings.accentColor,
    );
    document.body.style.setProperty(
      "--preview-model-color",
      nextSettings.previewColor,
    );
    document.body.style.setProperty(
      "--thumbnail-model-color",
      nextSettings.accentColor,
    );
    window.dispatchEvent(
      new CustomEvent("polytray-preview-color", {
        detail: nextSettings.previewColor,
      }),
    );
  }, []);

  const persistSettings = useCallback((nextSettings: AppSettings) => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      serializeAppSettings(nextSettings),
    );
  }, []);

  const getRuntimeSettings = useCallback(
    () => toRuntimeSettings(settingsRef.current),
    [],
  );

  const applyLibraryState = useCallback((nextState: LibraryState) => {
    libraryStateRef.current = nextState;
    setFolders(nextState.libraryFolders);
    foldersRef.current = nextState.libraryFolders;
  }, []);

  const persistLibraryState = useCallback((nextState: LibraryState) => {
    localStorage.setItem(
      LIBRARY_STATE_STORAGE_KEY,
      serializeLibraryState(nextState),
    );
  }, []);

  const applyCollectionsState = useCallback((nextState: CollectionsState) => {
    const normalized = normalizeCollectionsState(nextState);
    collectionsStateRef.current = normalized;
    setCollectionsState(normalized);
  }, []);

  const persistCollectionsState = useCallback((nextState: CollectionsState) => {
    localStorage.setItem(
      COLLECTIONS_STORAGE_KEY,
      serializeCollectionsState(nextState),
    );
  }, []);

  const fetchFiles = useCallback(async () => {
    const result = await window.polytray.getFiles({
      sort: sortRef.current,
      order: orderRef.current,
      extension: extensionRef.current,
      folder: activeFolderRef.current,
      search: searchRef.current,
      limit: settings.page_size,
      offset: 0,
    });
    const collection = collectionsStateRef.current.collections.find(
      (entry) => entry.id === collectionsStateRef.current.activeCollectionId,
    );
    const filteredFiles = collection
      ? result.files.filter((file) => collection.filePaths.includes(file.path))
      : result.files;
    setFiles(filteredFiles);

    const s = await window.polytray.getStats();
    setStats(s);
    const d = await window.polytray.getDirectories();
    setDirectories(d);
  }, [settings.page_size]);

  useEffect(() => {
    const debouncer = createRefreshDebouncer(() => {
      void fetchFiles();
    }, 150);
    fileRefreshDebouncerRef.current = debouncer;

    return () => {
      debouncer.cancel();
      if (fileRefreshDebouncerRef.current === debouncer) {
        fileRefreshDebouncerRef.current = null;
      }
    };
  }, [fetchFiles]);

  // ── IPC Listeners (once) ────────────────────────────────────────
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(
      window.polytray.onScanProgress(
        (data: {
          current: number;
          total: number;
          filename: string;
          skipped: boolean;
        }) => {
          const pct = Math.round((data.current / data.total) * 100);
          setProgress({
            visible: true,
            percent: pct,
            text: data.filename + (data.skipped ? " (cached)" : ""),
            count: `${data.current} / ${data.total}`,
          });
        },
      ),
    );

    cleanups.push(
      window.polytray.onScanComplete(async (data: { totalFiles: number }) => {
        setProgress((p) => ({
          ...p,
          percent: 100,
          text: `Scan complete — ${data.totalFiles} files`,
        }));

        await fetchFiles();

        window.polytray.startWatching(foldersRef.current, getRuntimeSettings());

        setTimeout(() => {
          setProgress((p) => {
            if (!isGeneratingRef.current) {
              return { ...p, visible: false };
            }
            return p;
          });
        }, 2000);
      }),
    );

    cleanups.push(
      window.polytray.onThumbnailProgress(
        (data: {
          current: number;
          total: number;
          filename: string;
          phase: string;
        }) => {
          const { current, total, filename, phase } = data;
          if (phase === "start") {
            isGeneratingRef.current = true;
            setProgress({
              visible: true,
              percent: 0,
              text: "Generating thumbnails...",
              count: `0 / ${total}`,
            });
            return;
          }
          if (phase === "done") {
            isGeneratingRef.current = false;
            setProgress({
              visible: true,
              percent: 100,
              text: `Thumbnails complete — ${total} generated`,
              count: `${total} / ${total}`,
            });
            setTimeout(
              () => setProgress((p) => ({ ...p, visible: false })),
              2000,
            );
            return;
          }
          const pct = Math.round((current / total) * 100);
          setProgress({
            visible: true,
            percent: pct,
            text: `Thumbnail: ${filename}`,
            count: `${current} / ${total}`,
          });
        },
      ),
    );

    cleanups.push(
      window.polytray.onThumbnailReady(
        async (data: { fileId: number; thumbnailPath: string }) => {
          const { fileId, thumbnailPath } = data;
          const dataUrl = await window.polytray.readThumbnail(thumbnailPath);
          if (!dataUrl) return;

          setFiles((prevFiles) =>
            prevFiles.map((f) =>
              f.id === fileId ? { ...f, thumbnail: dataUrl } : f,
            ),
          );
        },
      ),
    );

    cleanups.push(
      window.polytray.onFilesUpdated(async () => {
        fileRefreshDebouncerRef.current?.trigger();
      }),
    );

    return () => {
      cleanups.forEach((c) => c());
    };
  }, [fetchFiles, getRuntimeSettings]);

  // ── Boot ────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasBooted.current) return;
    hasBooted.current = true;

    (async () => {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      let loadedSettings = DEFAULT_APP_SETTINGS;

      if (raw) {
        try {
          loadedSettings = normalizeAppSettings(JSON.parse(raw));
        } catch (error) {
          console.error("Failed to parse settings", error);
        }
      }
      setSettings(loadedSettings);
      settingsRef.current = loadedSettings;
      persistSettings(loadedSettings);
      applySettingsToDocument(loadedSettings);

      const savedLibraryStateRaw = localStorage.getItem(
        LIBRARY_STATE_STORAGE_KEY,
      );
      let loadedLibraryState = DEFAULT_LIBRARY_STATE;

      if (savedLibraryStateRaw) {
        try {
          loadedLibraryState = normalizeLibraryState(
            JSON.parse(savedLibraryStateRaw),
          );
        } catch (error) {
          console.error("Failed to parse library state", error);
        }
      } else {
        const [legacyFolders, legacyLastFolder] = await Promise.all([
          window.polytray.getLibraryFolders(),
          window.polytray.getLastFolder(),
        ]);
        loadedLibraryState = normalizeLibraryState({
          libraryFolders: legacyFolders,
          lastFolder: legacyLastFolder,
        });
      }

      applyLibraryState(loadedLibraryState);
      persistLibraryState(loadedLibraryState);

      const savedCollectionsStateRaw = localStorage.getItem(
        COLLECTIONS_STORAGE_KEY,
      );
      let loadedCollectionsState = DEFAULT_COLLECTIONS_STATE;
      if (savedCollectionsStateRaw) {
        try {
          loadedCollectionsState = normalizeCollectionsState(
            JSON.parse(savedCollectionsStateRaw),
          );
        } catch (error) {
          console.error("Failed to parse collections state", error);
        }
      }
      applyCollectionsState(loadedCollectionsState);
      persistCollectionsState(loadedCollectionsState);

      if (loadedLibraryState.libraryFolders.length > 0) {
        const result = await window.polytray.getFiles({
          limit: loadedSettings.page_size,
          offset: 0,
        });
        setFiles(result.files);
        const s = await window.polytray.getStats();
        setStats(s);
        const d = await window.polytray.getDirectories();
        setDirectories(d);

        if (loadedSettings.watch) {
          window.polytray.startWatching(
            loadedLibraryState.libraryFolders,
            toRuntimeSettings(loadedSettings),
          );
        }

        if (loadedSettings.autoScan) {
          handleRescan();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applyLibraryState,
    applyCollectionsState,
    applySettingsToDocument,
    persistCollectionsState,
    persistLibraryState,
    persistSettings,
  ]);

  // ── Handlers ────────────────────────────────────────────────────
  const handleAddFolder = useCallback(async () => {
    const folder = await window.polytray.selectFolder();
    if (!folder) return;
    const nextLibraryState = withAddedLibraryFolder(
      libraryStateRef.current,
      folder,
    );
    applyLibraryState(nextLibraryState);
    persistLibraryState(nextLibraryState);
    // If watching is enabled, start watching the new set of folders
    if (settings.watch) {
      window.polytray.startWatching(
        nextLibraryState.libraryFolders,
        getRuntimeSettings(),
      );
    }
    setProgress({
      visible: true,
      percent: 0,
      text: "Starting scan...",
      count: "",
    });
    await window.polytray.scanFolder(folder, getRuntimeSettings());
  }, [
    applyLibraryState,
    getRuntimeSettings,
    persistLibraryState,
    settings.watch,
  ]);

  const handleRemoveFolder = useCallback(
    async (folderPath: string) => {
      await window.polytray.removeLibraryFolder(folderPath);
      const nextLibraryState = withRemovedLibraryFolder(
        libraryStateRef.current,
        folderPath,
      );
      applyLibraryState(nextLibraryState);
      persistLibraryState(nextLibraryState);
      // If watching is enabled, update watching with the new set of folders
      if (settings.watch) {
        window.polytray.startWatching(
          nextLibraryState.libraryFolders,
          getRuntimeSettings(),
        );
      } else {
        window.polytray.stopWatching();
      }
      if (activeFolderRef.current === folderPath) {
        setActiveFolder(null);
        activeFolderRef.current = null;
      }
      const result = await window.polytray.getFiles({
        sort: sortRef.current,
        order: orderRef.current,
        extension: extensionRef.current,
        folder: activeFolderRef.current,
        search: searchRef.current,
        limit: settingsRef.current.page_size,
        offset: 0,
      });
      setFiles(result.files);
      const s = await window.polytray.getStats();
      setStats(s);
      const d = await window.polytray.getDirectories();
      setDirectories(d);
    },
    [
      applyLibraryState,
      getRuntimeSettings,
      persistLibraryState,
      settings.watch,
    ],
  );

  const handleRescan = useCallback(async () => {
    for (const folder of foldersRef.current) {
      setProgress({
        visible: true,
        percent: 0,
        text: "Starting scan...",
        count: "",
      });
      await window.polytray.scanFolder(folder, getRuntimeSettings());
    }
  }, [getRuntimeSettings]);

  const handleClearThumbnails = useCallback(async () => {
    if (confirm("Regenerate all thumbnails? This may take a while.")) {
      await window.polytray.clearThumbnails(getRuntimeSettings());
      fetchFiles(); // Immediate UI update to show clear state
      for (const folder of foldersRef.current) {
        setProgress({
          visible: true,
          percent: 0,
          text: "Starting scan...",
          count: "",
        });
        await window.polytray.scanFolder(folder, getRuntimeSettings());
      }
    }
  }, [fetchFiles, getRuntimeSettings]);

  const handleSortChange = useCallback(
    async (newSort: string) => {
      setSort(newSort);
      sortRef.current = newSort;
      fetchFiles();
    },
    [fetchFiles],
  );

  const handleOrderToggle = useCallback(async () => {
    const newOrder = orderRef.current === "ASC" ? "DESC" : "ASC";
    setOrder(newOrder);
    orderRef.current = newOrder;
    fetchFiles();
  }, [fetchFiles]);

  const handleExtensionFilter = useCallback(
    async (ext: string | null) => {
      setExtension(ext);
      extensionRef.current = ext;
      fetchFiles();
    },
    [fetchFiles],
  );

  const handleSearch = useCallback(
    async (query: string) => {
      setSearch(query);
      searchRef.current = query;
      fetchFiles();
    },
    [fetchFiles],
  );

  const handleFolderSelect = useCallback(
    async (folderPath: string | null) => {
      setActiveFolder(folderPath);
      activeFolderRef.current = folderPath;
      fetchFiles();
    },
    [fetchFiles],
  );

  const handleRescanFolder = useCallback(
    async (folderPath: string) => {
      setProgress({
        visible: true,
        percent: 0,
        text: "Scanning folder...",
        count: "",
      });
      await window.polytray.scanFolder(folderPath, getRuntimeSettings());
    },
    [getRuntimeSettings],
  );

  const handleRefreshFolderThumbnails = useCallback(
    async (folderPath: string) => {
      setProgress({
        visible: true,
        percent: 0,
        text: "Refreshing thumbnails...",
        count: "",
      });
      await window.polytray.refreshFolderThumbnails(
        folderPath,
        getRuntimeSettings(),
      );
      fetchFiles(); // Update UI to show loading pulses
    },
    [fetchFiles, getRuntimeSettings],
  );

  const handleFileRecordUpdate = useCallback((updatedFile: FileRecord) => {
    setFiles((current) =>
      current.map((file) => (file.id === updatedFile.id ? updatedFile : file)),
    );
    setPreviewFile((current) =>
      current?.id === updatedFile.id ? updatedFile : current,
    );
  }, []);

  const handleToggleFileSelection = useCallback((fileId: number) => {
    setSelectedFileIds((current) =>
      current.includes(fileId)
        ? current.filter((id) => id !== fileId)
        : [...current, fileId],
    );
  }, []);

  const handleApplyBatchTags = useCallback(async () => {
    const normalizedInput = normalizeFileTags(batchTagsInput.split(","));
    if (selectedFiles.length === 0 || normalizedInput.length === 0) return;

    const updates = await Promise.all(
      selectedFiles.map((file) => {
        const mergedTags = normalizeFileTags([
          ...parseStoredFileTags(file.tags),
          ...normalizedInput,
        ]);
        return window.polytray.updateFileMetadata({
          id: file.id,
          tags: mergedTags,
        });
      }),
    );

    setFiles((current) =>
      current.map(
        (file) =>
          updates.find((updated) => updated.id === file.id) ?? file,
      ),
    );
    setPreviewFile((current) =>
      current
        ? (updates.find((updated) => updated.id === current.id) ?? current)
        : current,
    );
    setBatchTagsInput("");
  }, [batchTagsInput, selectedFiles]);

  const handleCollectionSelect = useCallback((collectionId: string | null) => {
    const nextState = normalizeCollectionsState({
      ...collectionsStateRef.current,
      activeCollectionId: collectionId,
    });
    applyCollectionsState(nextState);
    persistCollectionsState(nextState);
    void fetchFiles();
  }, [applyCollectionsState, fetchFiles, persistCollectionsState]);

  const handleCreateCollection = useCallback(
    (name: string, filePaths: string[]) => {
      const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || `collection-${Date.now()}`;
      let nextState = upsertCollection(collectionsStateRef.current, {
        id,
        name: name.trim(),
        filePaths,
      });
      nextState = normalizeCollectionsState({
        ...nextState,
        activeCollectionId: id,
      });
      applyCollectionsState(nextState);
      persistCollectionsState(nextState);
      void fetchFiles();
    },
    [applyCollectionsState, fetchFiles, persistCollectionsState],
  );

  const handleAddFilesToCollection = useCallback(
    (collectionId: string, filePaths: string[]) => {
      const nextState = addFilesToCollection(
        collectionsStateRef.current,
        collectionId,
        filePaths,
      );
      applyCollectionsState(nextState);
      persistCollectionsState(nextState);
      void fetchFiles();
    },
    [applyCollectionsState, fetchFiles, persistCollectionsState],
  );

  const handleBatchAddToCollection = useCallback(() => {
    if (!batchCollectionId || selectedFiles.length === 0) return;
    handleAddFilesToCollection(
      batchCollectionId,
      selectedFiles.map((file) => file.path),
    );
  }, [batchCollectionId, handleAddFilesToCollection, selectedFiles]);

  const handleRemoveCollection = useCallback(
    (collectionId: string) => {
      const nextState = removeCollection(collectionsStateRef.current, collectionId);
      applyCollectionsState(nextState);
      persistCollectionsState(nextState);
      void fetchFiles();
    },
    [applyCollectionsState, fetchFiles, persistCollectionsState],
  );

  const handleSettingsChange = useCallback(
    (newSettings: Partial<AppSettings>) => {
      setSettings((prev) => {
        const merged = normalizeAppSettings({ ...prev, ...newSettings });
        settingsRef.current = merged;
        persistSettings(merged);
        applySettingsToDocument(merged);
        return merged;
      });
    },
    [applySettingsToDocument, persistSettings],
  );

  // ── Reactive watch toggle ──────────────────────────────────────
  useEffect(() => {
    if (foldersRef.current.length === 0) return;

    if (settings.watch) {
      window.polytray.startWatching(foldersRef.current, getRuntimeSettings());
    } else {
      window.polytray.stopWatching();
    }
  }, [
    getRuntimeSettings,
    settings.watch,
    settings.thumbnail_timeout,
    settings.scanning_batch_size,
    settings.watcher_stability,
    settings.page_size,
    settings.thumbnailColor,
  ]);

  // Context Menu Callbacks
  useEffect(() => {
    const unsubscribe = window.polytray.onFolderAction((action, folderPath) => {
      if (action === "refresh") {
        handleRefreshFolderThumbnails(folderPath);
      } else if (action === "rescan") {
        handleRescanFolder(folderPath);
      }
    });

    return unsubscribe;
  }, [handleRefreshFolderThumbnails, handleRescanFolder]);

  // Keyboard: Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSettingsOpen((open) => {
          if (open) return false;
          return open;
        });
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // ── Render ──────────────────────────────────────────────────────
  // CRITICAL: #file-grid and #empty-state must be DIRECT children of
  // #content (not wrapped in fragments) because the CSS flex layout
  // depends on this parent-child relationship for scrolling.

  const hasFiles = files.length > 0;

  return (
    <>
      <div id="titlebar">
        <span className="titlebar-text">Polytray</span>
      </div>
      <div id="main-layout">
        <Sidebar
          folders={folders}
          directories={directories}
          collections={collectionsState.collections}
          activeCollectionId={collectionsState.activeCollectionId}
          stats={stats}
          activeFilter={extension}
          activeFolder={activeFolder}
          onFolderSelect={handleFolderSelect}
          onRescanFolder={handleRescanFolder}
          onAddFolder={handleAddFolder}
          onRemoveFolder={handleRemoveFolder}
          onFilterChange={handleExtensionFilter}
          onOpenSettings={() => setSettingsOpen(true)}
          lightMode={settings.lightMode}
          onSettingsChange={handleSettingsChange}
          onRefreshFolderThumbnails={handleRefreshFolderThumbnails}
          onCollectionSelect={handleCollectionSelect}
          onRemoveCollection={handleRemoveCollection}
        />
        <main id="content">
          <Toolbar
            sort={sort}
            order={order}
            search={search}
            activeFolderLabel={activeFolderLabel}
            activeCollectionLabel={activeCollectionLabel}
            activeFilter={extension}
            resultCount={files.length}
            onSortChange={handleSortChange}
            onOrderToggle={handleOrderToggle}
            onSearch={handleSearch}
            onRescan={handleRescan}
            onClearThumbnails={handleClearThumbnails}
          />
          <BatchActionsBar
            selectedCount={selectedFileIds.length}
            batchTagsInput={batchTagsInput}
            batchCollectionId={batchCollectionId}
            collections={collectionsState.collections}
            canCompare={selectedFileIds.length === 2}
            onBatchTagsInputChange={setBatchTagsInput}
            onBatchCollectionChange={setBatchCollectionId}
            onApplyBatchTags={() => void handleApplyBatchTags()}
            onAddToCollection={handleBatchAddToCollection}
            onCompare={() => {
              setPreviewFile(null);
              setComparisonFiles(selectedFiles.slice(0, 2));
            }}
            onClear={() => {
              setSelectedFileIds([]);
              setComparisonFiles([]);
            }}
          />
          <FileGrid
            files={files}
            gridSize={settings.gridSize}
            activeFileId={previewFile?.id ?? null}
            comparisonFileIds={comparisonFiles.map((file) => file.id)}
            selectedFileIds={selectedFileIds}
            onToggleFileSelection={handleToggleFileSelection}
            onSelectFile={(file) => {
              setComparisonFiles([]);
              setPreviewFile(file);
            }}
          />
          <EmptyState hidden={hasFiles} />
          <ScanProgress
            visible={progress.visible}
            percent={progress.percent}
            text={progress.text}
            count={progress.count}
          />
        </main>
        <ComparePanel
          files={comparisonFiles}
          onClose={() => setComparisonFiles([])}
          onOpenPreview={(file) => {
            setComparisonFiles([]);
            setPreviewFile(file);
          }}
        />
        <PreviewPanel
          file={comparisonActive ? null : previewFile}
          showGrid={settings.showGrid}
          thumbnailColor={settings.thumbnailColor}
          onFileChange={handleFileRecordUpdate}
          collections={collectionsState.collections}
          onCreateCollection={handleCreateCollection}
          onAddFilesToCollection={handleAddFilesToCollection}
          onClose={() => setPreviewFile(null)}
        />
      </div>
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
};

