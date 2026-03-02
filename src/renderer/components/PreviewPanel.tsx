import React, { useRef, useEffect, useState, useCallback } from "react";
import { formatSize, formatNumber } from "../lib/formatters";
import {
  initViewer,
  loadModelFromUrl,
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
  onClose: () => void;
}

export const PreviewPanel: React.FC<Props> = ({ file, showGrid, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number>(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [wireframe, setWireframe] = useState(false);

  // Load model when file changes
  useEffect(() => {
    if (!file) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setWireframe(false);
    setExpanded(false);

    const load = async () => {
      // Wait for the container to have dimensions
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled || !containerRef.current) return;

      try {
        initViewer(containerRef.current);
        await loadModelFromUrl(
          file.path,
          file.extension,
          file.name,
          (percent) => {
            if (!cancelled) setLoadProgress(percent);
          },
        );
        if (cancelled) return;
        setLoading(false);

        // Thumbnail robustness: attempt one last generation if missing
        if (!file.thumbnail) {
          window.polytray.requestThumbnailGeneration(file.path, file.extension);
        }
      } catch (e) {
        if (cancelled) return;
        console.error("Failed to load model:", e);
        setLoadError("Failed to load model file");
        setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
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
      <div className="viewer-header">
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
        <div className="viewer-controls">
          <button
            id="btn-wireframe"
            className={`btn-viewer${wireframe ? " active" : ""}`}
            title="Toggle wireframe"
            onClick={handleWireframe}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
          </button>
          <button
            id="btn-reset-camera"
            className="btn-viewer"
            title="Reset camera"
            onClick={resetCamera}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
              />
              <circle
                cx="8"
                cy="8"
                r="2"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
              />
              <line
                x1="8"
                y1="0.5"
                x2="8"
                y2="3"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <line
                x1="8"
                y1="13"
                x2="8"
                y2="15.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <line
                x1="0.5"
                y1="8"
                x2="3"
                y2="8"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <line
                x1="13"
                y1="8"
                x2="15.5"
                y2="8"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
          <button
            id="btn-expand-viewer"
            className="btn-viewer"
            title="Expand/Collapse"
            onClick={() => setExpanded((e) => !e)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <polyline
                points="10,2 14,2 14,6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <line
                x1="14"
                y1="2"
                x2="9.5"
                y2="6.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <polyline
                points="6,14 2,14 2,10"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <line
                x1="2"
                y1="14"
                x2="6.5"
                y2="9.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            id="btn-close-viewer"
            className="btn-viewer btn-close"
            title="Close viewer"
            onClick={handleClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
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
        <div
          className="spinner"
          style={{ display: loadError ? "none" : "block" }}
        />
        <span>
          {loadError
            ? loadError
            : loadProgress >= 0
              ? `Downloading model (${loadProgress}%)...`
              : "Processing 3D data..."}
        </span>
      </div>
    </aside>
  );
};
