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
  const [search, setSearch] = useState("");
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    visible: false,
    percent: 0,
    text: "",
    count: "",
  });
  const [settings, setSettings] = useState({
    lightMode: false,
    gridSize: "medium",
    autoScan: true,
    watch: true,
    showGrid: true,
    thumbQuality: "256",
  });

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
  const searchRef = useRef(search);
  searchRef.current = search;

  // ── Data Loading (uses refs for latest state) ───────────────────
  const loadFilesWithCurrentFilters = useCallback(async () => {
    const result = await window.polytray.getFiles({
      sort: sortRef.current,
      order: orderRef.current,
      extension: extensionRef.current,
      search: searchRef.current,
      limit: 500,
      offset: 0,
    });
    setFiles(result.files);
  }, []);

  const updateStats = useCallback(async () => {
    const s = await window.polytray.getStats();
    setStats(s);
  }, []);

  // ── IPC Listeners (once) ────────────────────────────────────────
  useEffect(() => {
    // Initial settings load
    try {
      const raw = localStorage.getItem("polytray-settings");
      if (raw) {
        const s = JSON.parse(raw);
        setSettings((prev) => ({ ...prev, ...s }));
        if (s.lightMode) document.body.classList.add("light");
      }
    } catch (e) {}

    const cleanups: (() => void)[] = [];

    cleanups.push(
      window.polytray.onScanProgress((data: any) => {
        const pct = Math.round((data.current / data.total) * 100);
        setProgress({
          visible: true,
          percent: pct,
          text: data.filename + (data.skipped ? " (cached)" : ""),
          count: `${data.current} / ${data.total}`,
        });
      }),
    );

    cleanups.push(
      window.polytray.onScanComplete(async (data: any) => {
        setProgress((p) => ({
          ...p,
          percent: 100,
          text: `Scan complete — ${data.totalFiles} files`,
        }));

        // Reload data using refs for current filter state
        const result = await window.polytray.getFiles({
          sort: sortRef.current,
          order: orderRef.current,
          extension: extensionRef.current,
          search: searchRef.current,
          limit: 500,
          offset: 0,
        });
        setFiles(result.files);

        const s = await window.polytray.getStats();
        setStats(s);

        // Start watching
        for (const folder of foldersRef.current) {
          window.polytray.startWatching(folder);
        }

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
      window.polytray.onThumbnailProgress((data: any) => {
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
      }),
    );

    cleanups.push(
      window.polytray.onThumbnailReady(async (data: any) => {
        const { fileId, thumbnailPath } = data;
        const dataUrl = await window.polytray.readThumbnail(thumbnailPath);
        if (!dataUrl) return;

        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === fileId ? { ...f, thumbnail: dataUrl } : f,
          ),
        );
      }),
    );

    cleanups.push(
      window.polytray.onFilesUpdated(async () => {
        const result = await window.polytray.getFiles({
          sort: sortRef.current,
          order: orderRef.current,
          extension: extensionRef.current,
          search: searchRef.current,
          limit: 500,
          offset: 0,
        });
        setFiles(result.files);
        const s = await window.polytray.getStats();
        setStats(s);
      }),
    );

    return () => {
      cleanups.forEach((c) => c());
    };
  }, []);

  // ── Boot ────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasBooted.current) return;
    hasBooted.current = true;

    (async () => {
      const f = await window.polytray.getLibraryFolders();
      setFolders(f);
      foldersRef.current = f;

      const raw = localStorage.getItem("polytray-settings");
      const savedSettings = raw ? JSON.parse(raw) : null;
      const shouldAutoScan = savedSettings?.autoScan ?? true;
      const shouldWatch = savedSettings?.watch ?? true;

      if (f.length > 0) {
        const result = await window.polytray.getFiles({
          limit: 500,
          offset: 0,
        });
        setFiles(result.files);
        const s = await window.polytray.getStats();
        setStats(s);

        if (shouldWatch) {
          for (const folder of f) {
            window.polytray.startWatching(folder);
          }
        }

        if (shouldAutoScan) {
          handleRescan();
        }
      }
    })();
  }, []);

  // ── Handlers ────────────────────────────────────────────────────
  const handleAddFolder = useCallback(async () => {
    const folder = await window.polytray.selectFolder();
    if (!folder) return;
    const f = await window.polytray.getLibraryFolders();
    setFolders(f);
    foldersRef.current = f;
    setProgress({
      visible: true,
      percent: 0,
      text: "Starting scan...",
      count: "",
    });
    await window.polytray.scanFolder(folder);
  }, []);

  const handleRemoveFolder = useCallback(async (folderPath: string) => {
    await window.polytray.removeLibraryFolder(folderPath);
    const f = await window.polytray.getLibraryFolders();
    setFolders(f);
    foldersRef.current = f;
    const result = await window.polytray.getFiles({ limit: 500, offset: 0 });
    setFiles(result.files);
    const s = await window.polytray.getStats();
    setStats(s);
  }, []);

  const handleRescan = useCallback(async () => {
    for (const folder of foldersRef.current) {
      setProgress({
        visible: true,
        percent: 0,
        text: "Starting scan...",
        count: "",
      });
      await window.polytray.scanFolder(folder);
    }
  }, []);

  const handleClearThumbnails = useCallback(async () => {
    if (confirm("Regenerate all thumbnails? This may take a while.")) {
      await window.polytray.clearThumbnails();
      for (const folder of foldersRef.current) {
        setProgress({
          visible: true,
          percent: 0,
          text: "Starting scan...",
          count: "",
        });
        await window.polytray.scanFolder(folder);
      }
    }
  }, []);

  const handleSortChange = useCallback(async (newSort: string) => {
    setSort(newSort);
    sortRef.current = newSort;
    const result = await window.polytray.getFiles({
      sort: newSort,
      order: orderRef.current,
      extension: extensionRef.current,
      search: searchRef.current,
      limit: 500,
      offset: 0,
    });
    setFiles(result.files);
  }, []);

  const handleOrderToggle = useCallback(async () => {
    const newOrder = orderRef.current === "ASC" ? "DESC" : "ASC";
    setOrder(newOrder);
    orderRef.current = newOrder;
    const result = await window.polytray.getFiles({
      sort: sortRef.current,
      order: newOrder,
      extension: extensionRef.current,
      search: searchRef.current,
      limit: 500,
      offset: 0,
    });
    setFiles(result.files);
  }, []);

  const handleExtensionFilter = useCallback(async (ext: string | null) => {
    setExtension(ext);
    extensionRef.current = ext;
    const result = await window.polytray.getFiles({
      sort: sortRef.current,
      order: orderRef.current,
      extension: ext,
      search: searchRef.current,
      limit: 500,
      offset: 0,
    });
    setFiles(result.files);
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    setSearch(query);
    searchRef.current = query;
    const result = await window.polytray.getFiles({
      sort: sortRef.current,
      order: orderRef.current,
      extension: extensionRef.current,
      search: query,
      limit: 500,
      offset: 0,
    });
    setFiles(result.files);
  }, []);

  const handleSettingsChange = useCallback((newSettings: any) => {
    setSettings((prev) => {
      const merged = { ...prev, ...newSettings };
      localStorage.setItem("polytray-settings", JSON.stringify(merged));

      // Immediate side effects
      if (typeof newSettings.lightMode !== "undefined") {
        document.body.classList.toggle("light", newSettings.lightMode);
      }
      return merged;
    });
  }, []);

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
          stats={stats}
          activeFilter={extension}
          onAddFolder={handleAddFolder}
          onRemoveFolder={handleRemoveFolder}
          onFilterChange={handleExtensionFilter}
          onOpenSettings={() => setSettingsOpen(true)}
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
          {/* file-grid is ALWAYS rendered as a direct child of #content */}
          <div
            id="file-grid"
            className={`file-grid size-${settings.gridSize}`}
            style={{ display: hasFiles ? "grid" : "none" }}
          >
            {files.map((file, index) => (
              <FileCardMemo
                key={file.id}
                file={file}
                index={index}
                onClick={() => setPreviewFile(file)}
              />
            ))}
          </div>
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

// ── FileCard (memoized to prevent unnecessary re-renders) ─────────

interface FileCardProps {
  file: FileRecord;
  index: number;
  onClick: () => void;
}

const FileCard: React.FC<FileCardProps> = ({ file, index, onClick }) => {
  const extClass = file.extension === "3mf" ? "threemf" : file.extension;
  const delay = `${Math.min(index * 20, 300)}ms`;

  return (
    <div
      className="file-card"
      data-file-id={file.id}
      style={{ animationDelay: delay }}
      onClick={onClick}
    >
      <div className="card-thumbnail">
        {!file.thumbnail && (
          <>
            <div className="thumbnail-pulse" />
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
    prev.index === next.index
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
      setSrc(thumbnailPath);
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
