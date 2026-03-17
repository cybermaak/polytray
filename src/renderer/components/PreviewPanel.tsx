import React, { useRef, useEffect, useState, useCallback } from "react";
import { formatDimensions, formatSize, formatNumber } from "../lib/formatters";
import type { FileRecord, ModelDimensions } from "../../shared/types";
import { normalizeFileTags, parseStoredFileTags } from "../../shared/fileTags";
import type { CollectionRecord } from "../../shared/libraryCollections";
import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import {
  type DisplayFileRecord,
  isArchiveSummaryRecord,
} from "../lib/archiveDisplay";
import { AppIcon } from "./AppIcon";
import {
  initViewer,
  loadModelWithWorker,
  disposeViewer,
  toggleWireframe,
  resetCamera,
  toggleGrid,
} from "../lib/viewer";

interface Props {
  file: FileRecord | null;
  item: DisplayFileRecord | null;
  showGrid: boolean;
  thumbnailColor: string;
  collections: CollectionRecord[];
  onFileChange?: (file: FileRecord) => void;
  onCreateCollection: (name: string, filePaths: string[]) => void;
  onAddFilesToCollection: (collectionId: string, filePaths: string[]) => void;
  onClose: () => void;
}

const ArchiveThumbImage: React.FC<{ thumbnailPath: string; name: string }> = ({
  thumbnailPath,
  name,
}) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    window.polytray.readThumbnail(thumbnailPath).then((dataUrl) => {
      if (!canceled) {
        setSrc(dataUrl);
      }
    });
    return () => {
      canceled = true;
    };
  }, [thumbnailPath]);

  if (!src) {
    return <span className="archive-thumb-fallback">{name.slice(0, 1).toUpperCase()}</span>;
  }

  return <img src={src} alt={name} draggable={false} />;
};

export const PreviewPanel: React.FC<Props> = ({
  file,
  item,
  showGrid,
  thumbnailColor,
  collections,
  onFileChange,
  onCreateCollection,
  onAddFilesToCollection,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number>(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [savedTags, setSavedTags] = useState<string[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [archiveEntryIndex, setArchiveEntryIndex] = useState(0);
  const archiveSummary = item && isArchiveSummaryRecord(item) ? item : null;
  const currentFile = archiveSummary
    ? archiveSummary.entries[Math.min(archiveEntryIndex, archiveSummary.entries.length - 1)] ?? null
    : file;
  const currentCollections = React.useMemo(
    () =>
      currentFile
        ? collections.filter((collection) => collection.filePaths.includes(currentFile.path))
        : [],
    [collections, currentFile],
  );

  // Load model when file changes
  useEffect(() => {
    if (!currentFile) return;

    const abortController = new AbortController();
    const { signal } = abortController;

    // These setState calls are intentional: reset UI state before async loading
    setLoading(true);
    setLoadError(null);
    setWireframe(false);
    setExpanded(false);

    const load = async () => {
      // Wait for the container to have dimensions
      await new Promise((r) => setTimeout(r, 50));
      if (signal.aborted || !containerRef.current) return;

      try {
        initViewer(containerRef.current);
        await loadModelWithWorker(
          currentFile.path,
          currentFile.extension,
          currentFile.name,
          signal,
          (percent) => {
            if (!signal.aborted) setLoadProgress(percent);
          }
        );

        if (signal.aborted) return;
        setLoading(false);

        // Thumbnail robustness: attempt one last generation if missing
        if (!currentFile.thumbnail) {
          window.polytray.requestThumbnailGeneration(currentFile.path, currentFile.extension, {
            thumbnail_timeout: DEFAULT_APP_SETTINGS.thumbnail_timeout,
            scanning_batch_size: DEFAULT_APP_SETTINGS.scanning_batch_size,
            watcher_stability: DEFAULT_APP_SETTINGS.watcher_stability,
            page_size: DEFAULT_APP_SETTINGS.page_size,
            thumbnailColor,
          });
        }
      } catch (e) {
        if (signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        console.error("Failed to load model:", e);
        setLoadError("Failed to load model file");
        setLoading(false);
      }
    };

    load();

    return () => {
      abortController.abort();
      disposeViewer();
    };
  }, [currentFile, thumbnailColor]);

  // Fire resize when expanding/collapsing
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
    return () => clearTimeout(t);
  }, [expanded]);

  const handleWireframe = useCallback(() => {
    setWireframe((w) => !w);
    toggleWireframe();
  }, []);

  const handleClose = useCallback(() => {
    setExpanded(false);
    disposeViewer();
    onClose();
  }, [onClose]);

  const handleSaveTags = useCallback(async () => {
    if (!currentFile) return;
    const normalized = normalizeFileTags(tagsInput.split(","));
    const updated = (await window.polytray.updateFileMetadata({
      id: currentFile.id,
      tags: normalized,
    })) as FileRecord;
    setSavedTags(normalized);
    setTagsInput(normalized.join(", "));
    onFileChange?.(updated);
  }, [currentFile, onFileChange, tagsInput]);

  const handleCreateAndAddCollection = useCallback(() => {
    if (!currentFile || !newCollectionName.trim()) return;
    onCreateCollection(newCollectionName, [currentFile.path]);
    setSelectedCollectionId(
      newCollectionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    );
    setNewCollectionName("");
  }, [currentFile, newCollectionName, onCreateCollection]);

  const handleAddToExistingCollection = useCallback(() => {
    if (!currentFile || !selectedCollectionId) return;
    onAddFilesToCollection(selectedCollectionId, [currentFile.path]);
    setSelectedCollectionId("");
  }, [currentFile, onAddFilesToCollection, selectedCollectionId]);

  // Escape key
  useEffect(() => {
    if (!item) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (expanded) {
          setExpanded(false);
          setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
        } else {
          handleClose();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [item, expanded, handleClose]);

  useEffect(() => {
    if (item) {
      toggleGrid(showGrid);
    }
  }, [showGrid, item]);

  useEffect(() => {
    const nextTags = parseStoredFileTags(currentFile?.tags);
    setSavedTags(nextTags);
    setTagsInput(nextTags.join(", "));
  }, [currentFile?.id, currentFile?.tags]);

  useEffect(() => {
    setSelectedCollectionId("");
    setNewCollectionName("");
  }, [currentFile?.id]);

  useEffect(() => {
    setArchiveEntryIndex(0);
  }, [archiveSummary?.path]);

  useEffect(() => {
    if (!selectedCollectionId) {
      return;
    }

    if (currentCollections.some((collection) => collection.id === selectedCollectionId)) {
      setSelectedCollectionId("");
    }
  }, [currentCollections, selectedCollectionId]);

  const panelClasses = [
    "preview-panel",
    !item ? "hidden" : "",
    expanded ? "expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const parsedDimensions = React.useMemo<ModelDimensions | null>(() => {
    if (!currentFile?.dimensions) return null;
    try {
      return JSON.parse(currentFile.dimensions) as ModelDimensions;
    } catch {
      return null;
    }
  }, [currentFile?.dimensions]);

  const archiveFormats = archiveSummary
    ? Array.from(new Set(archiveSummary.entries.map((entry) => entry.extension.toUpperCase()))).join(", ")
    : "";
  const renderArchiveThumb = (entry: FileRecord) => {
    if (!entry.thumbnail) {
      return <span className="archive-thumb-fallback">{entry.extension.toUpperCase()}</span>;
    }

    const src = entry.thumbnail.startsWith("data:")
      ? entry.thumbnail
      : undefined;

    if (src) {
      return <img src={src} alt={entry.name} draggable={false} />;
    }

    return <ArchiveThumbImage thumbnailPath={entry.thumbnail} name={entry.name} />;
  };

  return (
    <aside id="preview-panel" className={panelClasses}>
      <div className="viewer-header" style={{ justifyContent: "flex-end" }}>
        <div className="viewer-controls">
          <button
            id="btn-wireframe"
            className={`btn-viewer${wireframe ? " active" : ""}`}
            title="Toggle wireframe"
            onClick={handleWireframe}
          >
            <AppIcon name="wireframe" />
          </button>
          <button
            id="btn-reset-camera"
            className="btn-viewer"
            title="Reset camera"
            onClick={resetCamera}
          >
            <AppIcon name="preview" />
          </button>
          <button
            id="btn-expand-viewer"
            className="btn-viewer"
            title="Expand/Collapse"
            onClick={() => setExpanded((e) => !e)}
          >
            <AppIcon name="expand" />
          </button>
          <button
            id="btn-close-viewer"
            className="btn-viewer btn-close"
            title="Close viewer"
            onClick={handleClose}
          >
            <AppIcon name="close" />
          </button>
        </div>
      </div>

      <div
        className={`viewer-multi-model${archiveSummary ? "" : " hidden"}`}
        id="archive-preview-models"
      >
        {archiveSummary?.entries.map((entry, index) => (
          <button
            key={entry.path}
            type="button"
            className={`multi-model-thumb${archiveEntryIndex === index ? " active" : ""}`}
            onClick={() => setArchiveEntryIndex(index)}
            title={`${entry.name}.${entry.extension}`}
          >
            {renderArchiveThumb(entry)}
          </button>
        ))}
      </div>

      <div className="viewer-multi-model hidden" id="viewer-multi-model" />

      <div
        ref={containerRef}
        id="viewer-container"
        className="viewer-container"
      />

      <div
        id="viewer-loading"
        className={`viewer-loading${loading ? "" : " hidden"}`}
      >
        {!loadError &&
          (() => {
            const radius = 20;
            const circumference = 2 * Math.PI * radius;
            const isIndeterminate = loadProgress < 0;
            const pct = isIndeterminate ? 25 : loadProgress;
            const offset = circumference - (pct / 100) * circumference;
            return (
              <div
                className={`progress-ring${isIndeterminate ? " indeterminate" : ""}`}
              >
                <svg viewBox="0 0 48 48">
                  <circle className="ring-bg" cx="24" cy="24" r={radius} />
                  <circle
                    className="ring-fill"
                    cx="24"
                    cy="24"
                    r={radius}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                  />
                </svg>
                {!isIndeterminate && (
                  <span className="ring-label">{loadProgress}%</span>
                )}
              </div>
            );
          })()}
        <span>
          {loadError
            ? loadError
            : loadProgress >= 0
              ? `Loading model (${loadProgress}%)...`
              : "Processing 3D data..."}
        </span>
      </div>

      <div className="viewer-footer">
        <div className="viewer-title">
          <h2 id="viewer-filename" style={{ userSelect: "text" }}>
            {archiveSummary
              ? archiveSummary.name
              : currentFile
                ? `${currentFile.name}.${currentFile.extension}`
                : "model_name.stl"}
          </h2>
          <div
            className="viewer-path"
            id="viewer-path"
            title={archiveSummary?.path || currentFile?.path || ""}
          >
            <span
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {archiveSummary?.path || currentFile?.path || ""}
            </span>
            {(archiveSummary || currentFile) && (
              <button
                className="btn-copy-path"
                title="Copy full path"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(archiveSummary?.path || currentFile?.path || "");
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            )}
          </div>
          <div className="viewer-meta" id="viewer-meta">
            {archiveSummary
              ? `${archiveSummary.entries.length} models | ${formatSize(archiveSummary.size_bytes)} total | ${archiveFormats || "Mixed formats"}${currentFile ? ` | Viewing: ${currentFile.name}.${currentFile.extension}` : ""}`
              : currentFile
              ? `Volume: ${formatSize(currentFile.size_bytes)} | ${formatNumber(currentFile.face_count)} Faces | ${formatNumber(currentFile.vertex_count)} Vertices | ${formatDimensions(parsedDimensions)} | ${currentFile.extension.toUpperCase()}`
              : ""}
          </div>
          <div className="viewer-tags">
            <div className="viewer-tags-header">Tags</div>
            <div id="file-tags" className="tag-chip-list">
              {savedTags.length > 0 ? (
                savedTags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="tag-chip tag-chip-muted">No tags</span>
              )}
            </div>
            <div className="viewer-tag-editor">
              <input
                id="file-tags-input"
                type="text"
                value={tagsInput}
                placeholder="comma,separated,tags"
                onChange={(e) => setTagsInput(e.target.value)}
                disabled={!currentFile}
              />
              <button
                id="save-file-tags"
                className="btn-copy-path"
                onClick={handleSaveTags}
                disabled={!currentFile}
              >
                Save Tags
              </button>
            </div>
          </div>
          <div className="viewer-tags">
            <div className="viewer-tags-header">Collections</div>
            <div id="file-collections" className="tag-chip-list">
              {currentCollections.length > 0 ? (
                currentCollections.map((collection) => (
                  <span key={collection.id} className="tag-chip">
                    {collection.name}
                  </span>
                ))
              ) : (
                <span className="tag-chip tag-chip-muted">Not in any collections</span>
              )}
            </div>
            <div className="viewer-tag-editor">
              <select
                id="existing-collection-select"
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                disabled={!currentFile}
              >
                <option value="">Choose collection…</option>
                {collections
                  .filter(
                    (collection) =>
                      !currentCollections.some((entry) => entry.id === collection.id),
                  )
                  .map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                  ))}
              </select>
              <button
                id="add-to-existing-collection"
                className="btn-copy-path"
                onClick={handleAddToExistingCollection}
                disabled={!selectedCollectionId || !currentFile}
              >
                Add
              </button>
            </div>
            <div className="viewer-tag-editor">
              <input
                id="new-collection-name"
                type="text"
                value={newCollectionName}
                placeholder="New collection name"
                onChange={(e) => setNewCollectionName(e.target.value)}
                disabled={!currentFile}
              />
              <button
                id="create-and-add-collection"
                className="btn-copy-path"
                onClick={handleCreateAndAddCollection}
                disabled={!currentFile}
              >
                Create & Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
