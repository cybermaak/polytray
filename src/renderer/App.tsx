/**
 * App.tsx — Root React component.
 *
 * Reproduces the exact same DOM structure and IDs as the original
 * vanilla index.html + app.js, ensuring CSS and E2E tests work unchanged.
 */

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { PreviewPanel } from "./components/PreviewPanel";
import { ComparePanel } from "./components/ComparePanel";
import { SettingsModal } from "./components/SettingsModal";
import { BatchActionsBar } from "./components/BatchActionsBar";
import { EmptyState } from "./components/EmptyState";
import { FileGrid } from "./components/FileGrid";
import { ScanProgress } from "./components/ScanProgress";
import { createRefreshDebouncer, type RefreshTargets } from "./lib/refreshDebouncer";
import { calculatePanelLayout } from "./lib/panelLayout";
import {
  libraryQueryScopeKey,
  getAffectedTrackedFiles,
  removeDeletedFileIds,
  useLibraryPages,
} from "./hooks/useLibraryPages";
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
import type { FileRecord, ThumbnailReadyData, WatcherErrorData } from "../shared/types";
import type { MetadataBackupSnapshot, StagedMetadataRestore } from "../shared/backupContracts";
import type { LibraryQuery, LibraryItem } from "../shared/libraryQuery";
import type { PreviewTarget } from "../shared/previewTarget";
import { thumbnailImageCache } from "./lib/thumbnailImageCache";
import { createRendererMutationGate } from "./rendererMutationGate";
import { useBackgroundJobs } from "./hooks/useBackgroundJobs";
import {
  applyThumbnailReadyToRecord,
  invalidateThumbnailImages,
} from "./lib/thumbnailInvalidation";
import { patchPreviewTargetFile, preferCurrentFileRevision } from "./lib/fileRevision";

interface LibraryStats {
  total: number;
  stl: number;
  obj: number;
  threemf: number;
  totalSize: number;
}

const RENDERER_STATE_REVISION_KEY = "polytray-renderer-state-revision";
type RendererRestoreSnapshot = MetadataBackupSnapshot & { preferences: Record<string, unknown> };

function canonicalRootKey(folderPath: string) {
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const isWindowsPath = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//");
  return isWindowsPath ? normalized.toLowerCase() : normalized;
}

export const App: React.FC = () => {
  // ── State ───────────────────────────────────────────────────────
  const [folders, setFolders] = useState<string[]>([]);
  const [offlineRoots, setOfflineRoots] = useState<Map<string, string>>(() => new Map());
  const [watcherError, setWatcherError] = useState<WatcherErrorData | null>(null);
  const [watcherRetryRevision, setWatcherRetryRevision] = useState(0);
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
  const [searchDraft, setSearchDraft] = useState("");
  const [resultCountAnnouncement, setResultCountAnnouncement] = useState("");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const previewFocusReturnRef = useRef<HTMLElement | null>(null);
  const pendingPreviewScrollRestoreRef = useRef<number | null>(null);
  const pendingLibraryScrollAnchorRef = useRef<{
    itemKey: string;
    itemIndex: number;
    columns: number;
    rowStep: number;
    scrollTop: number;
  } | null>(null);
  const libraryScrollRestoreFrameRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (previewTarget !== null || pendingPreviewScrollRestoreRef.current === null) return;
    const scrollTop = pendingPreviewScrollRestoreRef.current;
    pendingPreviewScrollRestoreRef.current = null;
    const scroller = document.querySelector<HTMLElement>("[data-virtuoso-scroller]");
    if (scroller) scroller.scrollTop = scrollTop;
  }, [previewTarget]);
  const compareFocusReturnRef = useRef<HTMLElement | null>(null);
  const [comparisonFiles, setComparisonFiles] = useState<FileRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restoreRecoveryError, setRestoreRecoveryError] = useState<string | null>(null);
  const [rendererStateLocked, setRendererStateLocked] = useState(false);
  const [collectionsState, setCollectionsState] = useState<CollectionsState>(
    DEFAULT_COLLECTIONS_STATE,
  );
  const [selectedFilesById, setSelectedFilesById] = useState<Map<number, FileRecord>>(() => new Map());
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const [batchTagsInput, setBatchTagsInput] = useState("");
  const [batchCollectionId, setBatchCollectionId] = useState("");
  const backgroundJobs = useBackgroundJobs();
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
  useLayoutEffect(() => {
    const anchor = pendingLibraryScrollAnchorRef.current;
    if (!anchor || libraryPages.loading || libraryPages.refreshing) return;
    if (libraryScrollRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(libraryScrollRestoreFrameRef.current);
    }
    libraryScrollRestoreFrameRef.current = window.requestAnimationFrame(() => {
      libraryScrollRestoreFrameRef.current = null;
      if (pendingLibraryScrollAnchorRef.current !== anchor) return;
      pendingLibraryScrollAnchorRef.current = null;
      const scroller = document.querySelector<HTMLElement>("[data-virtuoso-scroller]");
      if (!scroller) return;
      const currentIndex = libraryPagesRef.current.items.findIndex((item) => item.key === anchor.itemKey);
      if (currentIndex < 0 || anchor.itemIndex < 0) {
        scroller.scrollTop = anchor.scrollTop;
        return;
      }
      const rowDelta = Math.floor(currentIndex / anchor.columns) - Math.floor(anchor.itemIndex / anchor.columns);
      scroller.scrollTop = Math.max(0, anchor.scrollTop + rowDelta * anchor.rowStep);
    });
    return () => {
      if (libraryScrollRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(libraryScrollRestoreFrameRef.current);
        libraryScrollRestoreFrameRef.current = null;
      }
    };
  }, [libraryPages.items, libraryPages.loading, libraryPages.refreshing, libraryPages.revision]);
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
  useEffect(() => {
    const timeout = window.setTimeout(() => setResultCountAnnouncement(`${resultCountLabel} available`), 250);
    return () => window.clearTimeout(timeout);
  }, [resultCountLabel]);
  const comparisonActive = comparisonFiles.length === 2;

  // Refs to get latest state in IPC callbacks
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const watcherOwnerConfigRef = useRef<{
    folders: string[];
    watch: boolean;
    watcherStability: number;
    shouldWatch: boolean;
  } | null>(null);
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
  const rendererStateRevisionRef = useRef(0);
  const rendererStateSnapshotReadyRef = useRef(false);
  const restoreMutationLockedRef = useRef(false);
  const applyingRestoreStateRef = useRef(false);
  const pendingRendererStateWritesRef = useRef(false);
  const rendererMutationGateRef = useRef(createRendererMutationGate());
  collectionsStateRef.current = collectionsState;
  const selectedFilesRef = useRef(selectedFilesById);
  selectedFilesRef.current = selectedFilesById;
  const comparisonFilesRef = useRef(comparisonFiles);
  comparisonFilesRef.current = comparisonFiles;
  const libraryPagesRef = useRef(libraryPages);
  libraryPagesRef.current = libraryPages;
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

  const getRuntimeSettings = useCallback(
    () => toRuntimeSettings(settingsRef.current),
    [],
  );

  const clearOfflineRoot = useCallback((folderPath: string) => {
    const rootKey = canonicalRootKey(folderPath);
    setOfflineRoots((current) => {
      if (!current.has(rootKey)) return current;
      const next = new Map(current);
      next.delete(rootKey);
      return next;
    });
  }, []);

  const scanLibraryFolder = useCallback(async (folderPath: string) => {
    const result = await window.polytray.scanFolder(folderPath, getRuntimeSettings());
    if (result.state === "completed" || result.state === "partial") clearOfflineRoot(folderPath);
    return result;
  }, [clearOfflineRoot, getRuntimeSettings]);

  const applyLibraryState = useCallback((nextState: LibraryState) => {
    libraryStateRef.current = nextState;
    setFolders(nextState.libraryFolders);
    foldersRef.current = nextState.libraryFolders;
    const configuredRootKeys = new Set(nextState.libraryFolders.map(canonicalRootKey));
    setOfflineRoots((current) => new Map([...current].filter(([key]) => configuredRootKeys.has(key))));
  }, []);

  const applyCollectionsState = useCallback((nextState: CollectionsState) => {
    const normalized = normalizeCollectionsState(nextState);
    collectionsStateRef.current = normalized;
    setCollectionsState(normalized);
  }, []);

  const buildRendererRestoreSnapshot = useCallback((rendererRevision = rendererStateRevisionRef.current): RendererRestoreSnapshot => ({
    rendererRevision,
    libraryRoots: [...libraryStateRef.current.libraryFolders],
    collections: collectionsStateRef.current.collections.map(collection => ({
      id: collection.id,
      name: collection.name,
      paths: [...collection.filePaths],
    })),
    preferences: { ...settingsRef.current },
  }), []);

  const publishRendererRestoreSnapshot = useCallback(async (snapshot = buildRendererRestoreSnapshot()) => {
    localStorage.setItem(RENDERER_STATE_REVISION_KEY, String(snapshot.rendererRevision));
    await window.polytray.publishMetadataRestoreSnapshot(snapshot);
  }, [buildRendererRestoreSnapshot]);

  const advanceRendererStateRevision = useCallback(() => {
    if (!rendererStateSnapshotReadyRef.current || applyingRestoreStateRef.current) return;
    if (restoreMutationLockedRef.current) {
      pendingRendererStateWritesRef.current = true;
      return;
    }
    rendererStateRevisionRef.current++;
    const snapshot = buildRendererRestoreSnapshot();
    void publishRendererRestoreSnapshot(snapshot).catch(error => {
      console.error("Failed to publish metadata restore snapshot", error);
    });
  }, [buildRendererRestoreSnapshot, publishRendererRestoreSnapshot]);

  const runRendererMutation = useCallback(<T,>(operation: () => T | Promise<T>) =>
    rendererMutationGateRef.current.run(operation), []);

  const flushQueuedRendererMutations = useCallback(() => {
    void rendererMutationGateRef.current.unlock().catch(error => {
      console.error("Failed to replay queued renderer mutations", error);
    });
  }, []);

  const persistSettings = useCallback((nextSettings: AppSettings) => {
    settingsRef.current = nextSettings;
    if (restoreMutationLockedRef.current && !applyingRestoreStateRef.current) {
      pendingRendererStateWritesRef.current = true;
      return;
    }
    localStorage.setItem(SETTINGS_STORAGE_KEY, serializeAppSettings(nextSettings));
    advanceRendererStateRevision();
  }, [advanceRendererStateRevision]);

  const persistLibraryState = useCallback((nextState: LibraryState) => {
    libraryStateRef.current = nextState;
    if (restoreMutationLockedRef.current && !applyingRestoreStateRef.current) {
      pendingRendererStateWritesRef.current = true;
      return;
    }
    localStorage.setItem(LIBRARY_STATE_STORAGE_KEY, serializeLibraryState(nextState));
    advanceRendererStateRevision();
  }, [advanceRendererStateRevision]);

  const persistCollectionsState = useCallback((nextState: CollectionsState) => {
    collectionsStateRef.current = normalizeCollectionsState(nextState);
    if (restoreMutationLockedRef.current && !applyingRestoreStateRef.current) {
      pendingRendererStateWritesRef.current = true;
      return;
    }
    localStorage.setItem(
      COLLECTIONS_STORAGE_KEY,
      serializeCollectionsState(nextState),
    );
    advanceRendererStateRevision();
  }, [advanceRendererStateRevision]);

  const handleRestoreApply = useCallback(async (request: { requestId: string; state: StagedMetadataRestore }) => {
    const staged = request.state;
    applyingRestoreStateRef.current = true;
    try {
      const nextSettings = normalizeAppSettings(staged.settings);
      const currentLastFolder = libraryStateRef.current.lastFolder;
      const nextLibraryState = normalizeLibraryState({
        libraryFolders: staged.libraryRoots,
        lastFolder: currentLastFolder && staged.libraryRoots.includes(currentLastFolder)
          ? currentLastFolder
          : staged.libraryRoots[0] ?? null,
      });
      const nextCollectionsState = normalizeCollectionsState({
        collections: staged.collections.map(collection => ({
          id: collection.id,
          name: collection.name,
          filePaths: collection.paths,
        })),
        activeCollectionId: collectionsStateRef.current.activeCollectionId,
      });

      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      applySettingsToDocument(nextSettings);
      applyLibraryState(nextLibraryState);
      applyCollectionsState(nextCollectionsState);
      localStorage.setItem(SETTINGS_STORAGE_KEY, serializeAppSettings(nextSettings));
      localStorage.setItem(LIBRARY_STATE_STORAGE_KEY, serializeLibraryState(nextLibraryState));
      localStorage.setItem(COLLECTIONS_STORAGE_KEY, serializeCollectionsState(nextCollectionsState));
      rendererStateRevisionRef.current = staged.rendererRevision;
      rendererStateSnapshotReadyRef.current = true;
      const snapshot = buildRendererRestoreSnapshot(staged.rendererRevision);
      await publishRendererRestoreSnapshot(snapshot);
      await window.polytray.acknowledgeMetadataRestoreApply(request.requestId, snapshot);
    } catch (error) {
      console.error("Failed to apply recovered metadata restore state", error);
      throw error;
    } finally {
      applyingRestoreStateRef.current = false;
    }
  }, [applyCollectionsState, applyLibraryState, applySettingsToDocument, buildRendererRestoreSnapshot, publishRendererRestoreSnapshot]);

  useEffect(() => {
    const stopApply = window.polytray.onMetadataRestoreApply(request => {
      void handleRestoreApply(request).catch(error => console.error("Metadata restore application failed", error));
    });
    const stopLock = window.polytray.onMetadataRestoreMutationLock(request => {
      void (async () => {
        restoreMutationLockedRef.current = request.locked;
        setRendererStateLocked(request.locked);
        if (request.locked) {
          await rendererMutationGateRef.current.lock();
          await publishRendererRestoreSnapshot(buildRendererRestoreSnapshot());
        }
        if (!request.locked && pendingRendererStateWritesRef.current) {
          pendingRendererStateWritesRef.current = false;
          localStorage.setItem(SETTINGS_STORAGE_KEY, serializeAppSettings(settingsRef.current));
          localStorage.setItem(LIBRARY_STATE_STORAGE_KEY, serializeLibraryState(libraryStateRef.current));
          localStorage.setItem(COLLECTIONS_STORAGE_KEY, serializeCollectionsState(collectionsStateRef.current));
          rendererStateRevisionRef.current++;
          await publishRendererRestoreSnapshot(buildRendererRestoreSnapshot());
        }
        if (!request.locked) flushQueuedRendererMutations();
        await window.polytray.acknowledgeMetadataRestoreMutationLock(request.requestId);
      })().catch(error => console.error("Failed to update metadata restore mutation lock", error));
    });
    const blockMutationEvent = (event: Event) => {
      if (!restoreMutationLockedRef.current && !rendererMutationGateRef.current.isLocked()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const mutationEvents = ["click", "pointerdown", "keydown", "submit", "input", "change"];
    mutationEvents.forEach(type => document.addEventListener(type, blockMutationEvent, true));
    return () => {
      stopApply();
      stopLock();
      mutationEvents.forEach(type => document.removeEventListener(type, blockMutationEvent, true));
    };
  }, [buildRendererRestoreSnapshot, flushQueuedRendererMutations, handleRestoreApply, publishRendererRestoreSnapshot]);

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
    const currentFile = current.get(file.id);
    if (!currentFile) return;
    const latest = preferCurrentFileRevision(currentFile, file);
    if (latest === currentFile) return;
    const next = new Map(current);
    next.set(file.id, latest);
    selectedFilesRef.current = next;
    setSelectedFilesById(next);
  }, []);

  const removeSelectedFiles = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    const next = new Map(selectedFilesRef.current);
    for (const id of ids) next.delete(id);
    selectedFilesRef.current = next;
    setSelectedFilesById(next);
    setComparisonFiles((current) => removeDeletedFileIds(current, ids));
    libraryPages.removeFiles(ids);
  }, [libraryPages.removeFiles]);

  const refreshLibrary = useCallback(async (targets: RefreshTargets = {
    pages: true,
    stats: true,
    topology: true,
  }) => {
    const reads: Promise<unknown>[] = [];
    if (targets.pages) {
      const scroller = document.querySelector<HTMLElement>("[data-virtuoso-scroller]");
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const cards = [...scroller.querySelectorAll<HTMLElement>("[data-item-key]")];
        const anchor = cards.find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.bottom > bounds.top && rect.top < bounds.bottom;
        });
        const grid = document.querySelector<HTMLElement>("#file-grid");
        const gridStyle = grid ? window.getComputedStyle(grid) : null;
        const columns = Math.max(1, gridStyle?.gridTemplateColumns.split(" ").length ?? 1);
        const cardHeight = anchor?.getBoundingClientRect().height ?? 0;
        const rowGap = Number.parseFloat(gridStyle?.rowGap ?? "0") || 0;
        const rowTops = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)))].sort((a, b) => a - b);
        const rowStep = rowTops.length > 1 ? rowTops[1] - rowTops[0] : cardHeight + rowGap;
        const itemKey = anchor?.dataset.itemKey ?? "";
        pendingLibraryScrollAnchorRef.current = anchor
          ? {
              itemKey,
              itemIndex: libraryPagesRef.current.items.findIndex((item) => item.key === itemKey),
              columns,
              rowStep,
              scrollTop: scroller.scrollTop,
            }
          : { itemKey: "", itemIndex: -1, columns, rowStep, scrollTop: scroller.scrollTop };
      }
      reads.push(libraryPages.refresh());
    }
    if (targets.stats) {
      reads.push(window.polytray.getStats().then(setStats));
    }
    if (targets.topology) {
      reads.push(window.polytray.getDirectories().then(setDirectories));
    }
    await Promise.all(reads);
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
    const debouncer = createRefreshDebouncer((targets) => {
      void refreshLibrary(targets);
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

    cleanups.push(window.polytray.onWatcherError(setWatcherError));

    cleanups.push(
      window.polytray.onScanComplete(async () => {
        await refreshLibrary();
      }),
    );

    cleanups.push(
      window.polytray.onThumbnailReady(
        (ready: ThumbnailReadyData) => {
          thumbnailImageCache.invalidate(ready.thumbnailPath);
          const currentPages = libraryPagesRef.current;
          const loadedFiles = currentPages.items.flatMap((item) =>
            item.kind === "file" ? [item.file] : item.thumbnailSamples,
          );
          const patchReady = (file: FileRecord) => applyThumbnailReadyToRecord(file, ready);
          currentPages.patchFiles(loadedFiles.map(patchReady).filter((file): file is FileRecord => Boolean(file)));

          const nextSelected = new Map(selectedFilesRef.current);
          for (const [id, file] of nextSelected) {
            const updated = patchReady(file);
            if (updated) nextSelected.set(id, updated);
          }
          if ([...nextSelected].some(([id, file]) => file !== selectedFilesRef.current.get(id))) {
            selectedFilesRef.current = nextSelected;
            setSelectedFilesById(nextSelected);
          }

          setLegacyFiles((previous) => previous.map((file) => patchReady(file) ?? file));
          setComparisonFiles((current) => current.map((file) => patchReady(file) ?? file));
          setPreviewTarget((current) => {
            if (current?.kind === "file") {
              const updated = patchReady(current.file);
              return updated ? { kind: "file", file: updated } : current;
            }
            if (current?.kind === "archive") {
              return {
                ...current,
                archive: {
                  ...current.archive,
                  thumbnailSamples: current.archive.thumbnailSamples.map((file) => patchReady(file) ?? file),
                },
              };
            }
            return current;
          });
        },
      ),
    );

    cleanups.push(
      window.polytray.onThumbnailInvalidated((event) => {
        const affectedModelPaths = invalidateThumbnailImages(event, thumbnailImageCache);
        const isAffected = (file: FileRecord) => affectedModelPaths === null || affectedModelPaths.has(file.path);
        const clearThumbnail = (file: FileRecord): FileRecord => ({
          ...file,
          thumbnail: null,
          thumbnail_failed: 0,
        });

        const currentPages = libraryPagesRef.current;
        const loadedFiles = currentPages.items.flatMap((item) =>
          item.kind === "file" ? [item.file] : item.thumbnailSamples,
        );
        currentPages.patchFiles(loadedFiles.filter(isAffected).map(clearThumbnail));

        const nextSelected = new Map(selectedFilesRef.current);
        for (const [id, file] of nextSelected) {
          if (isAffected(file)) nextSelected.set(id, clearThumbnail(file));
        }
        if (nextSelected.size !== selectedFilesRef.current.size
          || [...nextSelected].some(([id, file]) => file !== selectedFilesRef.current.get(id))) {
          selectedFilesRef.current = nextSelected;
          setSelectedFilesById(nextSelected);
        }

        setLegacyFiles((current) => current.map((file) => isAffected(file) ? clearThumbnail(file) : file));
        setComparisonFiles((current) => current.map((file) => isAffected(file) ? clearThumbnail(file) : file));
        setPreviewTarget((current) => {
          if (current?.kind === "file") {
            return isAffected(current.file) ? { kind: "file", file: clearThumbnail(current.file) } : current;
          }
          if (current?.kind === "archive") {
            return {
              ...current,
              archive: {
                ...current.archive,
                thumbnailSamples: current.archive.thumbnailSamples.map((file) =>
                  isAffected(file) ? clearThumbnail(file) : file,
                ),
              },
            };
          }
          return current;
        });
      }),
    );

    cleanups.push(
      window.polytray.onLibraryChanged(async (mutation) => {
        if (mutation.rowsChanged || mutation.annotationsChanged) {
          const tracked = getAffectedTrackedFiles(
            [...selectedFilesRef.current.values()],
            comparisonFilesRef.current,
            mutation.affectedPaths,
          );
          const results = await Promise.all(tracked.map(async (file) => ({
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
          const latestById = new Map(results.flatMap((result) => result.latest ? [[result.id, result.latest] as const] : []));
          setComparisonFiles((current) => removeDeletedFileIds(current, deletedIds)
            .map((file) => latestById.get(file.id) ?? file));
        }
        if (mutation.rowsChanged || (mutation.annotationsChanged && searchRef.current.length > 0)
          || mutation.statsChanged || mutation.topologyChanged) {
          fileRefreshDebouncerRef.current?.trigger({
            pages: mutation.rowsChanged || (mutation.annotationsChanged && searchRef.current.length > 0),
            stats: mutation.statsChanged,
            topology: mutation.topologyChanged,
          });
        }
      }),
    );

    cleanups.push(
      window.polytray.onFilesUpdated(async (notice) => {
        if (notice.type === "root-available") {
          clearOfflineRoot(notice.filePath);
        } else if (notice.type === "root-unavailable") {
          const rootKey = canonicalRootKey(notice.filePath);
          const configuredRoot = foldersRef.current.find((folder) => canonicalRootKey(folder) === rootKey);
          if (configuredRoot) {
            setOfflineRoots((current) => {
              const next = new Map(current);
              next.set(rootKey, configuredRoot);
              return next;
            });
          }
        }
        fileRefreshDebouncerRef.current?.trigger({ pages: true, stats: false, topology: false });
      }),
    );

    return () => {
      cleanups.forEach((c) => c());
    };
  }, [clearOfflineRoot, libraryPages.patchFile, refreshLibrary, removeSelectedFiles, updateSelectedFile]);

  // ── Boot ────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasBooted.current) return;
    hasBooted.current = true;

    (async () => {
      const savedRendererRevision = Number(localStorage.getItem(RENDERER_STATE_REVISION_KEY));
      rendererStateRevisionRef.current = Number.isSafeInteger(savedRendererRevision) && savedRendererRevision >= 0
        ? savedRendererRevision
        : 0;
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

      rendererStateSnapshotReadyRef.current = true;
      const bootSnapshot = buildRendererRestoreSnapshot();
      await publishRendererRestoreSnapshot(bootSnapshot);
      const recovery = await window.polytray.completeMetadataRestoreStartup(bootSnapshot);
      if (recovery.status === "blocked") {
        restoreMutationLockedRef.current = true;
        await rendererMutationGateRef.current.lock();
        setRendererStateLocked(true);
        setRestoreRecoveryError(recovery.message);
        console.error("Metadata restore recovery is blocked", recovery.message);
        setLibraryReady(true);
        return;
      }

      const currentSettings = settingsRef.current;
      const currentLibraryState = libraryStateRef.current;
      const currentCollectionsState = collectionsStateRef.current;

      try {
        const [legacyResult, nextStats, nextDirectories] = await Promise.all([
          window.polytray.getFiles({ limit: currentSettings.page_size, offset: 0 }),
          window.polytray.getStats(),
          window.polytray.getDirectories(),
        ]);
        const activeCollection = currentCollectionsState.collections.find(
          (collection) => collection.id === currentCollectionsState.activeCollectionId,
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

      if (currentLibraryState.libraryFolders.length > 0 && currentSettings.autoScan) {
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
    buildRendererRestoreSnapshot,
    publishRendererRestoreSnapshot,
  ]);

  // ── Handlers ────────────────────────────────────────────────────
  const handleAddFolder = useCallback(() => runRendererMutation(async () => {
    const folder = await window.polytray.selectFolder();
    if (!folder) return;
    const nextLibraryState = withAddedLibraryFolder(
      libraryStateRef.current,
      folder,
    );
    applyLibraryState(nextLibraryState);
    persistLibraryState(nextLibraryState);
    await scanLibraryFolder(folder);
  }), [
    applyLibraryState,
    persistLibraryState,
    runRendererMutation,
    scanLibraryFolder,
  ]);

  const handleRemoveFolder = useCallback(
    (folderPath: string) => runRendererMutation(async () => {
      await window.polytray.removeLibraryFolder(folderPath);
      const nextLibraryState = withRemovedLibraryFolder(
        libraryStateRef.current,
        folderPath,
      );
      applyLibraryState(nextLibraryState);
      persistLibraryState(nextLibraryState);
      if (activeFolderRef.current === folderPath) {
        setActiveFolder(null);
        activeFolderRef.current = null;
      }
      await refreshLibrary();
    }),
    [
      applyLibraryState,
      clearSelection,
      getRuntimeSettings,
      persistLibraryState,
      runRendererMutation,
      refreshLibrary,
    ],
  );

  const handleRescan = useCallback(async () => {
    for (const folder of foldersRef.current) {
      await scanLibraryFolder(folder);
    }
  }, [scanLibraryFolder]);

  const handleClearThumbnails = useCallback(async () => {
    if (confirm("Regenerate all thumbnails? This may take a while.")) {
      await window.polytray.clearThumbnails(getRuntimeSettings());
      for (const folder of foldersRef.current) {
        await scanLibraryFolder(folder);
      }
    }
  }, [getRuntimeSettings, scanLibraryFolder]);

  const handleSortChange = useCallback(
    async (newSort: string) => {
      if (sortRef.current !== newSort) clearSelection();
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
      if (extensionRef.current !== ext) clearSelection();
      setExtension(ext);
      extensionRef.current = ext;
    },
    [clearSelection],
  );

  const handleSearch = useCallback(
    async (query: string) => {
      if (searchRef.current !== query) clearSelection();
      setSearch(query);
      setSearchDraft(query);
      searchRef.current = query;
    },
    [clearSelection],
  );

  const handleFolderSelect = useCallback(
    async (folderPath: string | null) => {
      if (activeFolderRef.current !== folderPath) clearSelection();
      setActiveFolder(folderPath);
      activeFolderRef.current = folderPath;
    },
    [clearSelection],
  );

  const handleRescanFolder = useCallback(
    async (folderPath: string) => {
      await scanLibraryFolder(folderPath);
    },
    [scanLibraryFolder],
  );

  const handleRefreshFolderThumbnails = useCallback(
    async (folderPath: string) => {
      await window.polytray.refreshFolderThumbnails(
        folderPath,
        getRuntimeSettings(),
      );
    },
    [getRuntimeSettings],
  );

  const handleFileRecordUpdate = useCallback((updatedFile: FileRecord) => {
    libraryPages.patchFile(updatedFile);
    updateSelectedFile(updatedFile);
    setLegacyFiles((current) => current.map((file) => file.id === updatedFile.id
      ? preferCurrentFileRevision(file, updatedFile)
      : file));
    setComparisonFiles((current) => current.map((file) => file.id === updatedFile.id
      ? preferCurrentFileRevision(file, updatedFile)
      : file));
    setPreviewTarget((current) => patchPreviewTargetFile(current, updatedFile));
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

  const handleCollectionSelect = useCallback((collectionId: string | null) => runRendererMutation(() => {
    if (collectionsStateRef.current.activeCollectionId !== collectionId) clearSelection();
    const nextState = normalizeCollectionsState({
      ...collectionsStateRef.current,
      activeCollectionId: collectionId,
    });
    applyCollectionsState(nextState);
    persistCollectionsState(nextState);
  }), [applyCollectionsState, clearSelection, persistCollectionsState, runRendererMutation]);

  const handleCreateCollection = useCallback(
    (name: string, filePaths: string[]) => runRendererMutation(() => {
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
    }),
    [applyCollectionsState, clearSelection, persistCollectionsState, runRendererMutation],
  );

  const handleAddFilesToCollection = useCallback(
    (collectionId: string, filePaths: string[]) => runRendererMutation(() => {
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
    }),
    [applyCollectionsState, clearSelection, persistCollectionsState, refreshLibrary, runRendererMutation],
  );

  const handleBatchAddToCollection = useCallback(() => {
    if (!batchCollectionId || selectedFiles.length === 0) return;
    handleAddFilesToCollection(
      batchCollectionId,
      selectedFiles.map((file) => file.path),
    );
  }, [batchCollectionId, handleAddFilesToCollection, selectedFiles]);

  const handleSelectLibraryItem = useCallback((item: DisplayFileRecord) => {
    if (document.activeElement instanceof HTMLElement) previewFocusReturnRef.current = document.activeElement;
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
    compareFocusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreviewTarget(null);
    setComparisonFiles(selectedFiles.slice(0, 2));
  }, [selectedFiles]);

  const handleOpenComparedFile = useCallback((file: FileRecord) => {
    if (document.activeElement instanceof HTMLElement) previewFocusReturnRef.current = document.activeElement;
    setComparisonFiles([]);
    setPreviewTarget({ kind: "file", file });
  }, []);

  const handleCloseCompare = useCallback(() => {
    const invokingElement = compareFocusReturnRef.current;
    compareFocusReturnRef.current = null;
    setComparisonFiles([]);
    requestAnimationFrame(() => {
      if (invokingElement?.isConnected) {
        invokingElement.focus();
        return;
      }
      document.querySelector<HTMLElement>("#file-grid [data-item-key]")?.focus();
    });
  }, []);

  const handleClosePreview = useCallback(() => {
    const restoreOverlayScroll = Boolean(document.querySelector("#preview-panel.overlay"));
    const scrollTop = restoreOverlayScroll
      ? document.querySelector<HTMLElement>("[data-virtuoso-scroller]")?.scrollTop ?? null
      : null;
    pendingPreviewScrollRestoreRef.current = restoreOverlayScroll ? scrollTop : null;
    setPreviewTarget(null);
    const returnFocus = previewFocusReturnRef.current;
    previewFocusReturnRef.current = null;
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
      } else {
        document.querySelector<HTMLElement>("#file-grid [data-item-key][tabindex='0']")?.focus({ preventScroll: true });
      }
    });
  }, []);
  const handleLoadNextPage = useCallback(() => { void libraryPages.loadNext(); }, [libraryPages.loadNext]);
  const handleRetryPage = useCallback(() => { void libraryPages.retry(); }, [libraryPages.retry]);

  const handleRemoveCollection = useCallback(
    (collectionId: string) => runRendererMutation(() => {
      const nextState = removeCollection(collectionsStateRef.current, collectionId);
      if (collectionsStateRef.current.activeCollectionId === collectionId) clearSelection();
      applyCollectionsState(nextState);
      persistCollectionsState(nextState);
    }),
    [applyCollectionsState, clearSelection, persistCollectionsState, runRendererMutation],
  );

  const handleSettingsChange = useCallback(
    (newSettings: Partial<AppSettings>) => runRendererMutation(() => {
      setSettings((prev) => {
        const merged = normalizeAppSettings({ ...prev, ...newSettings });
        settingsRef.current = merged;
        persistSettings(merged);
        applySettingsToDocument(merged, prev.previewColor !== merged.previewColor);
        return merged;
      });
    }),
    [applySettingsToDocument, persistSettings, runRendererMutation],
  );

  const handleRetryWatcher = useCallback(() => {
    setWatcherError(null);
    watcherOwnerConfigRef.current = null;
    setWatcherRetryRevision((revision) => revision + 1);
  }, []);

  // ── Single watcher lifecycle and settings owner ────────────────
  useEffect(() => {
    const nextConfig = {
      folders: [...folders],
      watch: settings.watch,
      watcherStability: settings.watcher_stability,
      shouldWatch: settings.watch && folders.length > 0,
    };
    const previous = watcherOwnerConfigRef.current;
    const lifecycleChanged = !previous
      || previous.watch !== nextConfig.watch
      || previous.watcherStability !== nextConfig.watcherStability
      || previous.folders.length !== nextConfig.folders.length
      || previous.folders.some((folder, index) => folder !== nextConfig.folders[index]);
    watcherOwnerConfigRef.current = nextConfig;
    const runtimeSettings = toRuntimeSettings(settingsRef.current);
    const reportFailure = (message: string, error: unknown) => setWatcherError({
      rootPaths: [...folders],
      message: `${message}: ${error instanceof Error ? error.message : String(error)}`,
    });

    if (lifecycleChanged) {
      if (nextConfig.shouldWatch) {
        void window.polytray.startWatching(folders, runtimeSettings)
          .then(() => setWatcherError(null))
          .catch((error: unknown) => reportFailure("Could not start folder watching", error));
      } else if (previous?.shouldWatch) {
        void window.polytray.stopWatching()
          .then(() => setWatcherError(null))
          .catch((error: unknown) => reportFailure("Could not stop folder watching", error));
      }
      return;
    }

    if (nextConfig.shouldWatch) {
      void window.polytray.updateWatcherSettings(runtimeSettings)
        .then((updated) => { if (updated) setWatcherError(null); })
        .catch((error: unknown) => reportFailure("Could not update folder watching settings", error));
    }
  }, [folders, settings.watch, settings.watcher_stability, settings.thumbnail_timeout, settings.thumbnailColor, settings.thumbQuality, watcherRetryRevision]);

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
          {restoreRecoveryError && (
            <div role="alert" className="scan-error">
              Metadata restore recovery is blocked. Your saved metadata is protected; resolve this recovery issue before changing library settings. {restoreRecoveryError}
            </div>
          )}
          {watcherError && (
            <div className="watcher-error" role="alert">
              <div>
                <strong>Folder watching needs attention</strong>
                <p>{watcherError.message}</p>
                {watcherError.rootPaths.length > 0 && <ul>{watcherError.rootPaths.map((folder) => <li key={canonicalRootKey(folder)}>{folder}</li>)}</ul>}
              </div>
              {settings.watch && folders.length > 0
                ? <button type="button" onClick={handleRetryWatcher}>Retry watching</button>
                : <button type="button" onClick={() => setWatcherError(null)}>Dismiss</button>}
            </div>
          )}
          {offlineRoots.size > 0 && (
            <div className="offline-root-status" role="status" aria-live="polite" aria-atomic="true">
              <strong>{offlineRoots.size === 1 ? "Library folder unavailable" : `${offlineRoots.size} library folders unavailable`}</strong>
              <ul>{[...offlineRoots.values()].map((folder) => (
                <li key={canonicalRootKey(folder)}>
                  <span>{folder}</span>
                  <button type="button" aria-label={`Rescan ${folder}`} onClick={() => void handleRescanFolder(folder)}>Rescan</button>
                </li>
              ))}</ul>
              <span>{settings.watch
                ? "Indexed models remain available. Scanning resumes when a folder reconnects."
                : "Indexed models remain available. Reconnect a folder, then rescan it to check for changes."}</span>
            </div>
          )}
          <Toolbar
            sort={sort}
            order={order}
            search={search}
            searchDraft={searchDraft}
            activeFolderLabel={activeFolderLabel}
            activeCollectionLabel={activeCollectionLabel}
            activeFilter={extension}
            resultCount={resultTotalItems}
            onSortChange={handleSortChange}
            onOrderToggle={handleOrderToggle}
            onSearch={handleSearch}
            onSearchDraftChange={setSearchDraft}
            onRescan={handleRescan}
            onClearThumbnails={handleClearThumbnails}
            onDismissFolder={() => handleFolderSelect(null)}
            onDismissCollection={() => handleCollectionSelect(null)}
            onDismissFilter={() => handleExtensionFilter(null)}
            onDismissSearch={() => handleSearch("")}
          />
          <div
            id="library-result-total"
            aria-live="off"
            style={{ padding: "0 var(--space-4) var(--space-2)", color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}
          >
            {resultCountLabel}
          </div>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {resultCountAnnouncement}
          </div>
          <div id="grid-keyboard-hint" className="sr-only">
            Press Shift+Enter to toggle selection of the focused file and start batch selection. After one file is selected, Space toggles the focused file; Enter previews it.
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
            resultCount={resultTotalItems}
          />
          <EmptyState hidden={displayFiles.length > 0 || !libraryReady || libraryPages.loading || libraryPages.refreshing || libraryPages.error !== null} />
          <ScanProgress
            visible={backgroundJobs.jobs.length > 0}
            percent={0}
            text=""
            count=""
            jobs={backgroundJobs.jobs}
            pendingJobs={backgroundJobs.pending}
            commandErrors={backgroundJobs.commandErrors}
            onPause={backgroundJobs.pause}
            onResume={backgroundJobs.resume}
            onCancel={backgroundJobs.cancel}
            onRetry={backgroundJobs.retry}
            onDismiss={backgroundJobs.dismiss}
          />
        </main>
        <ComparePanel
          files={comparisonFiles}
          onClose={handleCloseCompare}
          onOpenPreview={handleOpenComparedFile}
        />
        <PreviewPanel
          file={comparisonActive ? null : previewFile}
          item={comparisonActive ? null : previewFile}
          target={comparisonActive ? null : previewTarget}
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
      {rendererStateLocked && (
        <div
          role="status"
          aria-live="assertive"
          style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", padding: 24, background: "rgba(0, 0, 0, 0.56)", color: "white", textAlign: "center" }}
        >
          {restoreRecoveryError
            ? `Metadata restore recovery is blocked. ${restoreRecoveryError}`
            : "Applying metadata restore. Please wait…"}
        </div>
      )}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
};
