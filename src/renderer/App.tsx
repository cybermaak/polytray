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
import { SettingsModal } from "./components/SettingsModal";
import { formatSize, formatVertices, formatTimestamp } from "./lib/formatters";
import { VirtuosoGrid } from "react-virtuoso";
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

// Types for file records from the database
interface FileRecord {
  id: number;
  path: string;
  name: string;
  extension: string;
  directory: string;
  size_bytes: number;
  modified_at: number;
  vertex_count: number;
  face_count: number;
  thumbnail: string | null;
  thumbnail_failed: number;
  indexed_at: number;
}

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    visible: false,
    percent: 0,
    text: "",
    count: "",
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

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

  const applySettingsToDocument = useCallback((nextSettings: AppSettings) => {
    document.body.classList.toggle("light", nextSettings.lightMode);
    document.body.style.setProperty("--accent-primary", nextSettings.accentColor);
    document.body.style.setProperty("--stl-color", nextSettings.accentColor);
    window.dispatchEvent(
      new CustomEvent("polytray-accent-color", {
        detail: nextSettings.accentColor,
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
    setFiles(result.files);

    const s = await window.polytray.getStats();
    setStats(s);
    const d = await window.polytray.getDirectories();
    setDirectories(d);
  }, [settings.page_size]);

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

        window.polytray.startWatching(
          foldersRef.current,
          getRuntimeSettings(),
        );

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
        fetchFiles();
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

      const savedLibraryStateRaw = localStorage.getItem(LIBRARY_STATE_STORAGE_KEY);
      let loadedLibraryState = DEFAULT_LIBRARY_STATE;

      if (savedLibraryStateRaw) {
        try {
          loadedLibraryState = normalizeLibraryState(JSON.parse(savedLibraryStateRaw));
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
  }, [applyLibraryState, applySettingsToDocument, persistLibraryState, persistSettings]);

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
  }, [applyLibraryState, getRuntimeSettings, persistLibraryState, settings.watch]);

  const handleRemoveFolder = useCallback(async (folderPath: string) => {
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
  }, [applyLibraryState, getRuntimeSettings, persistLibraryState, settings.watch]);

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

  const handleSortChange = useCallback(async (newSort: string) => {
    setSort(newSort);
    sortRef.current = newSort;
    fetchFiles();
  }, [fetchFiles]);

  const handleOrderToggle = useCallback(async () => {
    const newOrder = orderRef.current === "ASC" ? "DESC" : "ASC";
    setOrder(newOrder);
    orderRef.current = newOrder;
    fetchFiles();
  }, [fetchFiles]);

  const handleExtensionFilter = useCallback(async (ext: string | null) => {
    setExtension(ext);
    extensionRef.current = ext;
    fetchFiles();
  }, [fetchFiles]);

  const handleSearch = useCallback(async (query: string) => {
    setSearch(query);
    searchRef.current = query;
    fetchFiles();
  }, [fetchFiles]);



  const handleFolderSelect = useCallback(async (folderPath: string | null) => {
    setActiveFolder(folderPath);
    activeFolderRef.current = folderPath;
    fetchFiles();
  }, [fetchFiles]);

  const handleRescanFolder = useCallback(async (folderPath: string) => {
    setProgress({
      visible: true,
      percent: 0,
      text: "Scanning folder...",
      count: "",
    });
    await window.polytray.scanFolder(folderPath, getRuntimeSettings());
  }, [getRuntimeSettings]);

  const handleRefreshFolderThumbnails = useCallback(async (folderPath: string) => {
    setProgress({
      visible: true,
      percent: 0,
      text: "Refreshing thumbnails...",
      count: "",
    });
    await window.polytray.refreshFolderThumbnails(folderPath, getRuntimeSettings());
    fetchFiles(); // Update UI to show loading pulses
  }, [fetchFiles, getRuntimeSettings]);

  const handleSettingsChange = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const merged = normalizeAppSettings({ ...prev, ...newSettings });
      settingsRef.current = merged;
      persistSettings(merged);
      applySettingsToDocument(merged);
      return merged;
    });
  }, [applySettingsToDocument, persistSettings]);

  // ── Reactive watch toggle ──────────────────────────────────────
  useEffect(() => {
    if (foldersRef.current.length === 0) return;

    if (settings.watch) {
      window.polytray.startWatching(foldersRef.current, getRuntimeSettings());
    } else {
      window.polytray.stopWatching();
    }
  }, [getRuntimeSettings, settings.watch]);

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
        />
        <main id="content">
          <Toolbar
            sort={sort}
            order={order}
            search={search}
            onSortChange={handleSortChange}
            onOrderToggle={handleOrderToggle}
            onSearch={handleSearch}
            onRescan={handleRescan}
            onClearThumbnails={handleClearThumbnails}
          />
          {/* VirtuosoGrid virtualizes the DOM elements for massive efficiency. */}
          {hasFiles && (
            <VirtuosoGrid
              style={{ flex: 1, minHeight: 0 }}
              data={files}
              context={{ gridSize: settings.gridSize }}
              components={{
                List: GridList,
                Item: GridItem,
              }}
              itemContent={(index, file) => (
                <FileCardMemo
                  key={file.id}
                  file={file}
                  index={index}
                  selected={previewFile?.id === file.id}
                  onClick={() => setPreviewFile(file)}
                />
              )}
            />
          )}
          <div
            id="empty-state"
            className={`empty-state${hasFiles ? " hidden" : ""}`}
          >
            <div className="empty-icon">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <path
                  d="M8 16a8 8 0 018-8h11.51a8 8 0 015.657 2.343l2.49 2.49A8 8 0 0041.314 15H48a8 8 0 018 8v25a8 8 0 01-8 8H16a8 8 0 01-8-8V16z"
                  stroke="currentColor"
                  strokeWidth="2"
                  opacity="0.3"
                />
                <path
                  d="M24 36h16M32 28v16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.3"
                />
              </svg>
            </div>
            <h2>No 3D files found</h2>
            <p>Select a folder to scan for .obj, .stl, and .3mf files</p>
          </div>

          {/* Progress bar */}
          <div
            id="scan-progress"
            className={`scan-progress${progress.visible ? "" : " hidden"}`}
          >
            <div className="progress-bar">
              <div
                className="progress-fill"
                id="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="progress-text">
              <span id="progress-text">{progress.text}</span>
              <span id="progress-count">{progress.count}</span>
            </div>
          </div>
        </main>
        <PreviewPanel
          file={previewFile}
          showGrid={settings.showGrid}
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

// ── Helpers for VirtuosoGrid ────────────────────────────────────

const GridList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { context?: { gridSize?: string } }
>(({ style, children, context, ...props }, ref) => {
  return (
    <div
      ref={ref}
      {...props}
      id="file-grid"
      className={`file-grid size-${context?.gridSize || "medium"}`}
      style={{
        ...style,
        display: "grid",
        padding: "var(--space-4)",
        gap: "var(--space-3)",
        alignContent: "start",
      }}
    >
      {children}
    </div>
  );
});

const GridItem = ({
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} style={{ display: "flex", flexDirection: "column" }}>
    {children}
  </div>
);

// ── FileCard (memoized to prevent unnecessary re-renders) ─────────

interface FileCardProps {
  file: FileRecord;
  index: number;
  selected?: boolean;
  onClick: () => void;
}

const FileCard: React.FC<FileCardProps> = ({
  file,
  index: _index,
  selected,
  onClick,
}) => {
  const extClass = file.extension === "3mf" ? "threemf" : file.extension;

  return (
    <div
      className={`file-card${selected ? " selected" : ""}`}
      data-file-id={file.id}
      onClick={onClick}
      draggable={true}
      onDragStart={(e) => {
        e.preventDefault();
        window.polytray.startDrag(file.path);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        window.polytray.showContextMenu(file.path);
      }}
    >
      <div className="card-thumbnail">
        {!file.thumbnail && (
          <>
            {!file.thumbnail_failed ? (
              <div className="thumbnail-pulse" />
            ) : (
              <div className="thumbnail-error-bg" />
            )}
            <svg
              className={`placeholder-icon ${file.thumbnail_failed ? "error" : ""}`}
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
            >
              {!file.thumbnail_failed ? (
                <>
                  <path
                    d="M24 4L42 14v20L24 44 6 34V14L24 4z"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                  />
                  <path
                    d="M24 4v20m0 20V24m18-10L24 24M6 14l18 10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    opacity="0.5"
                  />
                </>
              ) : (
                // A broken/missing file icon
                <>
                  <path
                    d="M12 8C12 5.79086 13.7909 4 16 4H26L36 14V40C36 42.2091 34.2091 44 32 44H16C13.7909 44 12 42.2091 12 40V8Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M24 18L24 28"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M24 34V34.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </>
              )}
            </svg>
          </>
        )}
        {file.thumbnail && (
          <ThumbnailImage thumbnailPath={file.thumbnail} name={file.name} />
        )}
        <span className={`card-ext-badge ${extClass}`}>
          {file.extension.toUpperCase()}
        </span>
      </div>
      <div className="card-info">
        <div className="card-name" title={file.name}>
          {file.name}
        </div>
        <div className="card-meta">
          <span>{formatSize(file.size_bytes)}</span>
          <span>{formatVertices(file.vertex_count)}</span>
        </div>
        <div className="card-timestamp">
          {formatTimestamp(file.modified_at)}
        </div>
      </div>
    </div>
  );
};

const FileCardMemo = React.memo(FileCard, (prev, next) => {
  return (
    prev.file.id === next.file.id &&
    prev.file.thumbnail === next.file.thumbnail &&
    prev.index === next.index &&
    prev.selected === next.selected
  );
});

// ── ThumbnailImage (loads via IPC, avoids re-render of parent) ────

const ThumbnailImage: React.FC<{ thumbnailPath: string; name: string }> = ({
  thumbnailPath,
  name,
}) => {
  const [src, setSrc] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (thumbnailPath.startsWith("data:")) {
      // Setting initial src synchronously here is intentional: thumbnailPath is already a data URL
      setSrc(thumbnailPath); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }

    let cancelled = false;
    window.polytray
      .readThumbnail(thumbnailPath)
      .then((dataUrl: string | null) => {
        if (!cancelled && mountedRef.current && dataUrl) {
          setSrc(dataUrl);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [thumbnailPath]);

  if (!src) {
    return (
      <svg
        className="placeholder-icon"
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
      >
        <path
          d="M24 4L42 14v20L24 44 6 34V14L24 4z"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <path
          d="M24 4v20m0 20V24m18-10L24 24M6 14l18 10"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.5"
        />
      </svg>
    );
  }

  return <img alt={name} src={src} loading="lazy" />;
};

export default App;
