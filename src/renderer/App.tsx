/**
 * App.tsx — Root React component.
 *
 * Reproduces the exact same DOM structure and IDs as the original
 * vanilla index.html + app.js, ensuring CSS and E2E tests work unchanged.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { getScanProgressPresentation } from "./lib/scanProgress";
import { calculatePanelLayout } from "./lib/panelLayout";
import { libraryQueryScopeKey, useLibraryPages } from "./hooks/useLibraryPages";
import {
  type DisplayFileRecord,
  formatArchiveFolderLabel,
  getArchiveRootVirtualPath,
  isArchiveSummaryRecord,
  isLibraryArchiveDisplayRecord,
  libraryItemToDisplayRecord,
} from "./lib/archiveDisplay";
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
import type { FileRecord, ScanProgressData } from "../shared/types";
import type { LibraryQuery, LibraryItem } from "../shared/libraryQuery";
import type { PreviewTarget } from "../shared/previewTarget";
import { thumbnailImageCache } from "./lib/thumbnailImageCache";

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
  const [legacyFiles, setLegacyFiles] = useState<FileRecord[]>([]);
  const [legacyTotalItems, setLegacyTotalItems] = useState(0);
  const [libraryReady, setLibraryReady] = useState(false);
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState<"ASC" | "DESC">("ASC");
  const [extension, setExtension] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [comparisonFiles, setComparisonFiles] = useState<FileRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionsState, setCollectionsState] = useState<CollectionsState>(
    DEFAULT_COLLECTIONS_STATE,
  );
  const [selectedFilesById, setSelectedFilesById] = useState<Map<number, FileRecord>>(() => new Map());
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const [batchTagsInput, setBatchTagsInput] = useState("");
  const [batchCollectionId, setBatchCollectionId] = useState("");
  const [progress, setProgress] = useState<ProgressState>({
    visible: false,
    percent: 0,
    text: "",
    count: "",
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);
  const panelLayout = calculatePanelLayout({
    windowWidth: layoutWidth,
    sidebarWidth: settings.sidebarWidth,
    preferredPreviewWidth: settings.previewWidth,
  });
  const activeFolderLabel = activeFolder
    ? formatArchiveFolderLabel(activeFolder)?.split(/[\\/]/).filter(Boolean).pop()
      || formatArchiveFolderLabel(activeFolder)
    : null;
  const activeCollection = collectionsState.collections.find(
    (collection) => collection.id === collectionsState.activeCollectionId,
  ) || null;
  const activeCollectionLabel = activeCollection?.name || null;
  const previewFile = previewTarget?.kind === "file" ? previewTarget.file : null;
  const pageQuery = useMemo<LibraryQuery>(() => ({
    sort: sort as LibraryQuery["sort"],
    direction: order,
    extension,
    folder: activeFolder,
    search,
    collectionPaths: activeCollection?.filePaths ?? null,
    limit: settings.page_size,
    offset: 0,
  }), [sort, order, extension, activeFolder, search, activeCollection, settings.page_size]);
  const libraryPages = useLibraryPages(pageQuery, libraryReady);
  const legacyItems = useMemo<LibraryItem[]>(() => legacyFiles.map((file) => ({
    kind: "file",
    key: `file:${file.id}`,
    file,
  })), [legacyFiles]);
  const pageItems = libraryPages.ready
    ? libraryPages.items
    : libraryPages.generation <= 1 ? legacyItems : [];
  const displayFiles = useMemo(() => pageItems.map(libraryItemToDisplayRecord), [pageItems]);
  const selectedFiles = useMemo(() => [...selectedFilesById.values()], [selectedFilesById]);
  const selectedFileIds = useMemo(() => new Set(selectedFilesById.keys()), [selectedFilesById]);
  const comparisonItemKeys = useMemo(
    () => new Set(comparisonFiles.map((file) => `file:${file.id}`)),
    [comparisonFiles],
  );
  const activeItemKey = previewTarget
    ? previewTarget.kind === "file" ? `file:${previewTarget.file.id}` : previewTarget.archive.key
    : null;
  const resultTotalItems = libraryPages.ready ? libraryPages.totalItems : legacyTotalItems;
  const resultTotalModels = libraryPages.ready ? libraryPages.totalModels : legacyTotalItems;
  const resultCountLabel = !libraryReady || (libraryPages.loading && !libraryPages.ready)
    ? "Loading result counts…"
    : resultTotalItems === resultTotalModels
      ? `${resultTotalModels} ${resultTotalModels === 1 ? "model" : "models"}`
      : `${resultTotalItems} items / ${resultTotalModels} models`;
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
  collectionsStateRef.current = collectionsState;
  const selectedFilesRef = useRef(selectedFilesById);
  selectedFilesRef.current = selectedFilesById;
  const fileRefreshDebouncerRef = useRef<ReturnType<
    typeof createRefreshDebouncer
  > | null>(null);

  useEffect(() => {
    const layout = document.getElementById("main-layout");
    if (!layout) return;
    const updateWidth = () => {
      const nextWidth = layout.clientWidth;
      setLayoutWidth((current) => current === nextWidth ? current : nextWidth);
    };
    const observer = new ResizeObserver(updateWidth);
    observer.observe(layout);
    updateWidth();
    return () => observer.disconnect();
  }, []);

  const applySettingsToDocument = useCallback((nextSettings: AppSettings, previewColorChanged = true) => {
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
    if (previewColorChanged) {
      window.dispatchEvent(
        new CustomEvent("polytray-preview-color", {
          detail: nextSettings.previewColor,
        }),
      );
    }
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

  const clearSelection = useCallback((announcement = "Selection cleared because the library query changed.") => {
    if (selectedFilesRef.current.size === 0) return;
    selectedFilesRef.current = new Map();
    setSelectedFilesById(new Map());
    setBatchTagsInput("");
    setBatchCollectionId("");
    setSelectionAnnouncement(announcement);
  }, []);

  const updateSelectedFile = useCallback((file: FileRecord) => {
    const current = selectedFilesRef.current;
    if (!current.has(file.id)) return;
    const next = new Map(current);
    next.set(file.id, file);
    selectedFilesRef.current = next;
    setSelectedFilesById(next);
  }, []);

  const removeSelectedFiles = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    const next = new Map(selectedFilesRef.current);
    for (const id of ids) next.delete(id);
    selectedFilesRef.current = next;
    setSelectedFilesById(next);
    libraryPages.removeFiles(ids);
  }, [libraryPages.removeFiles]);

  const refreshLibrary = useCallback(async () => {
    const pageRefresh = libraryPages.refresh();
    const [nextStats, nextDirectories] = await Promise.all([
      window.polytray.getStats(),
      window.polytray.getDirectories(),
    ]);
    setStats(nextStats);
    setDirectories(nextDirectories);
    await pageRefresh;
  }, [libraryPages.refresh]);

  const queryScopeKey = libraryQueryScopeKey(pageQuery);
  const previousScopeKey = useRef(queryScopeKey);
  useEffect(() => {
    if (previousScopeKey.current !== queryScopeKey) {
      previousScopeKey.current = queryScopeKey;
      clearSelection();
    }
  }, [clearSelection, queryScopeKey]);

  useEffect(() => {
    const debouncer = createRefreshDebouncer(() => {
      void refreshLibrary();
    }, 150);
    fileRefreshDebouncerRef.current = debouncer;

    return () => {
      debouncer.cancel();
      if (fileRefreshDebouncerRef.current === debouncer) {
        fileRefreshDebouncerRef.current = null;
      }
    };
  }, [refreshLibrary]);

  // ── IPC Listeners (once) ────────────────────────────────────────
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(
      window.polytray.onScanProgress((data: ScanProgressData) => {
        const display = getScanProgressPresentation(data);
        setProgress({
          visible: true,
          percent: display.percent,
          text: display.text,
          count: display.count,
        });
      }),
    );

    cleanups.push(
      window.polytray.onScanComplete(async (data: { totalFiles: number }) => {
        setProgress((p) => ({
          ...p,
          percent: 100,
          text: `Scan complete — ${data.totalFiles} files`,
        }));

        await refreshLibrary();

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
          thumbnailImageCache.invalidate(thumbnailPath);
          const file = await window.polytray.getFileById(fileId);
          if (!file) return;
          libraryPages.patchFile(file);
          updateSelectedFile(file);
          setLegacyFiles((previous) => previous.map((entry) => entry.id === fileId ? file : entry));
          setPreviewTarget((current) => current?.kind === "file" && current.file.id === fileId
            ? { kind: "file", file }
            : current);
        },
      ),
    );

    cleanups.push(
      window.polytray.onLibraryChanged(async (mutation) => {
        if (mutation.rowsChanged || mutation.annotationsChanged) {
          const affected = new Set(mutation.affectedPaths);
          const selected = [...selectedFilesRef.current.values()].filter((file) => affected.has(file.path));
          const results = await Promise.all(selected.map(async (file) => ({
            id: file.id,
            latest: await window.polytray.getFileById(file.id),
          })));
          const deletedIds = results.filter((result) => !result.latest).map((result) => result.id);
          for (const result of results) {
            if (result.latest) {
              libraryPages.patchFile(result.latest);
              updateSelectedFile(result.latest);
            }
          }
          removeSelectedFiles(deletedIds);
          fileRefreshDebouncerRef.current?.trigger();
        }
      }),
    );

    cleanups.push(
      window.polytray.onFilesUpdated(async () => {
        fileRefreshDebouncerRef.current?.trigger();
      }),
    );

    return () => {
      cleanups.forEach((c) => c());
    };
  }, [getRuntimeSettings, libraryPages.patchFile, refreshLibrary, removeSelectedFiles, updateSelectedFile]);

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

      try {
        const [legacyResult, nextStats, nextDirectories] = await Promise.all([
          window.polytray.getFiles({ limit: loadedSettings.page_size, offset: 0 }),
          window.polytray.getStats(),
          window.polytray.getDirectories(),
        ]);
        const activeCollection = loadedCollectionsState.collections.find(
          (collection) => collection.id === loadedCollectionsState.activeCollectionId,
        );
        const fallbackFiles = activeCollection
          ? legacyResult.files.filter((file) => activeCollection.filePaths.includes(file.path))
          : legacyResult.files;
        setLegacyFiles(fallbackFiles);
        setLegacyTotalItems(activeCollection ? fallbackFiles.length : legacyResult.total);
        setStats(nextStats);
        setDirectories(nextDirectories);
      } catch (error) {
        console.warn("The legacy library reader could not provide startup results; the paged reader will retry.", error);
      } finally {
        setLibraryReady(true);
      }

      if (loadedLibraryState.libraryFolders.length > 0 && loadedSettings.watch) {
        window.polytray.startWatching(
          loadedLibraryState.libraryFolders,
          toRuntimeSettings(loadedSettings),
        );
      }

      if (loadedLibraryState.libraryFolders.length > 0 && loadedSettings.autoScan) {
        handleRescan();
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
      clearSelection();
      await refreshLibrary();
    },
    [
      applyLibraryState,
      clearSelection,
      getRuntimeSettings,
      persistLibraryState,
      refreshLibrary,
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
      await refreshLibrary();
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
  }, [getRuntimeSettings, refreshLibrary]);

  const handleSortChange = useCallback(
    async (newSort: string) => {
      clearSelection();
      setSort(newSort);
      sortRef.current = newSort;
    },
    [clearSelection],
  );

  const handleOrderToggle = useCallback(async () => {
    clearSelection();
    const newOrder = orderRef.current === "ASC" ? "DESC" : "ASC";
    setOrder(newOrder);
    orderRef.current = newOrder;
  }, [clearSelection]);

  const handleExtensionFilter = useCallback(
    async (ext: string | null) => {
      clearSelection();
      setExtension(ext);
      extensionRef.current = ext;
    },
    [clearSelection],
  );

  const handleSearch = useCallback(
    async (query: string) => {
      clearSelection();
      setSearch(query);
      searchRef.current = query;
    },
    [clearSelection],
  );

  const handleFolderSelect = useCallback(
    async (folderPath: string | null) => {
      clearSelection();
      setActiveFolder(folderPath);
      activeFolderRef.current = folderPath;
    },
    [clearSelection],
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
      await refreshLibrary();
    },
    [getRuntimeSettings, refreshLibrary],
  );

  const handleFileRecordUpdate = useCallback((updatedFile: FileRecord) => {
    libraryPages.patchFile(updatedFile);
    updateSelectedFile(updatedFile);
    setLegacyFiles((current) => current.map((file) => file.id === updatedFile.id ? updatedFile : file));
    setPreviewTarget((current) => current?.kind === "file" && current.file.id === updatedFile.id
      ? { kind: "file", file: updatedFile }
      : current);
  }, [libraryPages.patchFile, updateSelectedFile]);

  const handleToggleFileSelection = useCallback((file: FileRecord) => {
    const current = selectedFilesRef.current;
    const next = new Map(current);
    if (next.has(file.id)) next.delete(file.id);
    else next.set(file.id, file);
    selectedFilesRef.current = next;
    setSelectedFilesById(next);
    setSelectionAnnouncement("");
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

    updates.forEach(handleFileRecordUpdate);
    setBatchTagsInput("");
  }, [batchTagsInput, handleFileRecordUpdate, selectedFiles]);

  const handleCollectionSelect = useCallback((collectionId: string | null) => {
    clearSelection();
    const nextState = normalizeCollectionsState({
      ...collectionsStateRef.current,
      activeCollectionId: collectionId,
    });
    applyCollectionsState(nextState);
    persistCollectionsState(nextState);
  }, [applyCollectionsState, clearSelection, persistCollectionsState]);

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
      clearSelection();
      applyCollectionsState(nextState);
      persistCollectionsState(nextState);
    },
    [applyCollectionsState, clearSelection, persistCollectionsState],
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
      if (collectionsStateRef.current.activeCollectionId === collectionId) {
        clearSelection();
        void refreshLibrary();
      }
    },
    [applyCollectionsState, clearSelection, persistCollectionsState, refreshLibrary],
  );

  const handleBatchAddToCollection = useCallback(() => {
    if (!batchCollectionId || selectedFiles.length === 0) return;
    handleAddFilesToCollection(
      batchCollectionId,
      selectedFiles.map((file) => file.path),
    );
  }, [batchCollectionId, handleAddFilesToCollection, selectedFiles]);

  const handleSelectLibraryItem = useCallback((item: DisplayFileRecord) => {
    setComparisonFiles([]);
    if (isLibraryArchiveDisplayRecord(item)) {
      setPreviewTarget({ kind: "archive", archive: item.source, query: pageQuery });
      return;
    }
    if (isArchiveSummaryRecord(item)) return;
    setPreviewTarget({ kind: "file", file: item });
  }, [pageQuery]);

  const handleOpenArchive = useCallback((archivePath: string) => {
    clearSelection();
    const archiveFolder = getArchiveRootVirtualPath(archivePath);
    setActiveFolder(archiveFolder);
    activeFolderRef.current = archiveFolder;
  }, [clearSelection]);

  const handleCompareSelected = useCallback(() => {
    setPreviewTarget(null);
    setComparisonFiles(selectedFiles.slice(0, 2));
  }, [selectedFiles]);

  const handleOpenComparedFile = useCallback((file: FileRecord) => {
    setComparisonFiles([]);
    setPreviewTarget({ kind: "file", file });
  }, []);

  const handleClosePreview = useCallback(() => setPreviewTarget(null), []);
  const handleLoadNextPage = useCallback(() => { void libraryPages.loadNext(); }, [libraryPages.loadNext]);
  const handleRetryPage = useCallback(() => { void libraryPages.retry(); }, [libraryPages.retry]);

  const handleRemoveCollection = useCallback(
    (collectionId: string) => {
      const nextState = removeCollection(collectionsStateRef.current, collectionId);
      clearSelection();
      applyCollectionsState(nextState);
      persistCollectionsState(nextState);
    },
    [applyCollectionsState, clearSelection, persistCollectionsState],
  );

  const handleSettingsChange = useCallback(
    (newSettings: Partial<AppSettings>) => {
      setSettings((prev) => {
        const merged = normalizeAppSettings({ ...prev, ...newSettings });
        settingsRef.current = merged;
        persistSettings(merged);
        applySettingsToDocument(merged, prev.previewColor !== merged.previewColor);
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

  useEffect(() => {
    return window.polytray.onArchiveOpen((archiveVirtualPath) => {
      clearSelection();
      setActiveFolder(archiveVirtualPath);
      activeFolderRef.current = archiveVirtualPath;
    });
  }, [clearSelection]);

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
          preferredWidth={settings.sidebarWidth}
          effectiveWidth={panelLayout.sidebarWidth}
          onPreferredWidthChange={(sidebarWidth) => handleSettingsChange({ sidebarWidth })}
        />
        <main id="content">
          <Toolbar
            sort={sort}
            order={order}
            search={search}
            activeFolderLabel={activeFolderLabel}
            activeCollectionLabel={activeCollectionLabel}
            activeFilter={extension}
            resultCount={resultTotalItems}
            onSortChange={handleSortChange}
            onOrderToggle={handleOrderToggle}
            onSearch={handleSearch}
            onRescan={handleRescan}
            onClearThumbnails={handleClearThumbnails}
            onDismissFolder={() => handleFolderSelect(null)}
            onDismissCollection={() => handleCollectionSelect(null)}
            onDismissFilter={() => handleExtensionFilter(null)}
            onDismissSearch={() => handleSearch("")}
          />
          <div
            id="library-result-total"
            role="status"
            aria-live="polite"
            style={{ padding: "0 var(--space-4) var(--space-2)", color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}
          >
            {resultCountLabel}
          </div>
          <BatchActionsBar
            selectedCount={selectedFiles.length}
            batchTagsInput={batchTagsInput}
            batchCollectionId={batchCollectionId}
            collections={collectionsState.collections}
            canCompare={selectedFiles.length === 2}
            onBatchTagsInputChange={setBatchTagsInput}
            onBatchCollectionChange={setBatchCollectionId}
            onApplyBatchTags={() => void handleApplyBatchTags()}
            onAddToCollection={handleBatchAddToCollection}
            onCompare={handleCompareSelected}
            onClear={() => {
              clearSelection("Selection cleared.");
              setComparisonFiles([]);
            }}
            selectionAnnouncement={selectionAnnouncement}
          />
          <FileGrid
            files={displayFiles}
            gridSize={settings.gridSize}
            activeItemKey={activeItemKey}
            comparisonItemKeys={comparisonItemKeys}
            selectedFileIds={selectedFileIds}
            onToggleFileSelection={handleToggleFileSelection}
            onSelectFile={handleSelectLibraryItem}
            onOpenArchive={handleOpenArchive}
            pageLoading={libraryPages.loading}
            pageRefreshing={libraryPages.refreshing}
            pageLoadingNext={libraryPages.loadingNext}
            pageError={libraryPages.error?.message ?? null}
            hasMore={libraryPages.nextOffset !== null}
            onEndReached={handleLoadNextPage}
            onRetry={handleRetryPage}
          />
          <EmptyState hidden={displayFiles.length > 0 || !libraryReady || libraryPages.loading || libraryPages.refreshing || libraryPages.error !== null} />
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
          onOpenPreview={handleOpenComparedFile}
        />
        <PreviewPanel
          file={comparisonActive ? null : previewFile}
          item={comparisonActive ? null : previewFile}
          showGrid={settings.showGrid}
          thumbnailColor={settings.thumbnailColor}
          thumbQuality={settings.thumbQuality}
          onFileChange={handleFileRecordUpdate}
          collections={collectionsState.collections}
          preferredWidth={settings.previewWidth}
          effectiveWidth={panelLayout.previewWidth}
          overlay={panelLayout.mode === "overlay"}
          onPreferredWidthChange={(previewWidth) => handleSettingsChange({ previewWidth })}
          onCreateCollection={handleCreateCollection}
          onAddFilesToCollection={handleAddFilesToCollection}
          onClose={handleClosePreview}
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
