import React from "react";
import { formatMeasurement, formatNumber, formatSize } from "../lib/formatters";
import type { FileRecord } from "../../shared/types";
import { parseStoredFileTags } from "../../shared/fileTags";
import { ThumbnailImage } from "./ThumbnailImage";

interface Props {
  files: FileRecord[];
  onClose: () => void;
  onOpenPreview: (file: FileRecord) => void;
}

const CompareThumbnail: React.FC<{ file: FileRecord }> = ({ file }) => (
  <div className="compare-thumb-placeholder" style={{ position: "relative" }}>
    <span>{file.name.slice(0, 1).toUpperCase()}</span>
    <ThumbnailImage
      thumbnailPath={file.thumbnail}
      identity={file.content_revision}
      className="compare-thumb-image"
      alt=""
      style={{ position: "absolute", inset: 0 }}
    />
  </div>
);

export const ComparePanel: React.FC<Props> = ({ files, onClose, onOpenPreview }) => {
  const visible = files.length === 2;

  return (
    <aside id="compare-panel" className={`compare-panel${visible ? "" : " hidden"}`}>
      <div className="compare-header">
        <div>
          <div className="compare-title">Compare Models</div>
          <div className="compare-subtitle">Side-by-side metadata and thumbnail comparison for the selected pair.</div>
        </div>
        <button id="btn-close-compare" className="settings-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="compare-grid">
        {files.map((file, index) => {
          const tags = parseStoredFileTags(file.tags);
          return (
            <section key={file.id} className="compare-card" id={`compare-card-${index + 1}`}>
              <div className="compare-thumb-wrap">
                <CompareThumbnail file={file} />
              </div>
              <div className="compare-card-body">
                <div className="compare-file-header">
                  <div>
                    <div className="compare-file-name">{file.name}</div>
                    <div className="compare-file-ext">{file.extension.toUpperCase()}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-icon"
                    id={`open-compare-preview-${index + 1}`}
                    onClick={() => onOpenPreview(file)}
                  >
                    Open Preview
                  </button>
                </div>
                <dl className="compare-metrics">
                  <div>
                    <dt>File size</dt>
                    <dd>{formatSize(file.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt>Faces</dt>
                    <dd>{formatNumber(file.face_count)}</dd>
                  </div>
                  <div>
                    <dt>Vertices</dt>
                    <dd>{formatNumber(file.vertex_count)}</dd>
                  </div>
                  <div>
                    <dt>Dimensions</dt>
                    <dd>{formatMeasurement(file.dimensions)}</dd>
                  </div>
                </dl>
                <div className="compare-tags">
                  {tags.length > 0 ? (
                    tags.map((tag) => (
                      <span key={tag} className="tag-chip compare-tag-chip">{tag}</span>
                    ))
                  ) : (
                    <span className="compare-empty-tags">No tags</span>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
};
