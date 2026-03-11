import React, { useRef, useEffect, useState, useCallback } from "react";
import { formatSize, formatNumber } from "../lib/formatters";
import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import { AppIcon } from "./AppIcon";
import {
  initViewer,
  loadModelWithWorker,
  disposeViewer,
  toggleWireframe,
  resetCamera,
  toggleGrid,
} from "../lib/viewer";

interface FileRecord {
  id: number;
  path: string;
  name: string;
  extension: string;
  directory: string;
  size_bytes: number;
  vertex_count: number;
  face_count: number;
  thumbnail?: string | null;
}

interface Props {
  file: FileRecord | null;
  showGrid: boolean;
  thumbnailColor: string;
  onClose: () => void;
}

export const PreviewPanel: React.FC<Props> = ({
  file,
  showGrid,
  thumbnailColor,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number>(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [wireframe, setWireframe] = useState(false);

  // Load model when file changes
  useEffect(() => {
    if (!file) return;

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
          file.path,
          file.extension,
          file.name,
          signal,
          (percent) => {
            if (!signal.aborted) setLoadProgress(percent);
          }
        );

        if (signal.aborted) return;
        setLoading(false);

        // Thumbnail robustness: attempt one last generation if missing
        if (!file.thumbnail) {
          window.polytray.requestThumbnailGeneration(file.path, file.extension, {
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
  }, [file]);

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

  // Escape key
  useEffect(() => {
    if (!file) return;
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
  }, [file, expanded, handleClose]);

  useEffect(() => {
    if (file) {
      toggleGrid(showGrid);
    }
  }, [showGrid, file]);

  const panelClasses = [
    "preview-panel",
    !file ? "hidden" : "",
    expanded ? "expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

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
            {file ? `${file.name}.${file.extension}` : "model_name.stl"}
          </h2>
          <div
            className="viewer-path"
            id="viewer-path"
            title={file?.path || ""}
          >
            <span
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {file?.path || ""}
            </span>
            {file && (
              <button
                className="btn-copy-path"
                title="Copy full path"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(file.path);
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
            {file
              ? `Volume: ${formatSize(file.size_bytes)} | ${formatNumber(file.face_count)} Faces | ${formatNumber(file.vertex_count)} Vertices | ${file.extension.toUpperCase()}`
              : ""}
          </div>
        </div>
      </div>
    </aside>
  );
};
