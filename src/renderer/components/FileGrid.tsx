import React, { useEffect, useRef, useState } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import { formatSize, formatTimestamp, formatVertices } from "../lib/formatters";
import type { FileRecord } from "../../shared/types";
import { isArchiveEntryPath } from "../../shared/archivePaths";

interface Props {
  files: FileRecord[];
  gridSize: "small" | "medium" | "large";
  activeFileId: number | null;
  comparisonFileIds: number[];
  selectedFileIds: number[];
  onToggleFileSelection: (fileId: number) => void;
  onSelectFile: (file: FileRecord) => void;
}

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
    let canceled = false;
    setSrc(null);
    window.polytray.readThumbnail(thumbnailPath).then((dataUrl) => {
      if (!canceled && mountedRef.current) {
        setSrc(dataUrl);
      }
    });
    return () => {
      canceled = true;
    };
  }, [thumbnailPath]);

  if (!src) {
    return null;
  }

  return <img src={src} alt={name} draggable={false} />;
};

const FileCard: React.FC<{
  file: FileRecord;
  selected: boolean;
  selectedForBatch: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}> = ({ file, selected, selectedForBatch, onToggleSelect, onClick }) => {
  const extClass = file.extension === "3mf" ? "threemf" : file.extension;
  const isArchiveEntry = isArchiveEntryPath(file.path);

  return (
    <div
      className={`file-card${selected ? " selected" : ""}`}
      data-file-id={file.id}
      onClick={onClick}
      draggable={!isArchiveEntry}
      onDragStart={(e) => {
        if (isArchiveEntry) return;
        e.preventDefault();
        window.polytray.startDrag(file.path);
      }}
      onContextMenu={(e) => {
        if (isArchiveEntry) return;
        e.preventDefault();
        window.polytray.showContextMenu(file.path);
      }}
    >
      <button
        type="button"
        className={`file-select-toggle${selectedForBatch ? " active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
      >
        {selectedForBatch ? "✓" : ""}
      </button>
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
                  <path d="M24 4L42 14v20L24 44 6 34V14L24 4z" stroke="currentColor" strokeWidth="2" fill="none" />
                  <path d="M24 4v20m0 20V24m18-10L24 24M6 14l18 10" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                </>
              ) : (
                <>
                  <path d="M12 8C12 5.79086 13.7909 4 16 4H26L36 14V40C36 42.2091 34.2091 44 32 44H16C13.7909 44 12 42.2091 12 40V8Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M24 18L24 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M24 34V34.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </>
              )}
            </svg>
          </>
        )}
        {file.thumbnail && <ThumbnailImage thumbnailPath={file.thumbnail} name={file.name} />}
        <span className={`card-ext-badge ${extClass}`}>{file.extension.toUpperCase()}</span>
      </div>
      <div className="card-info">
        <div className="card-name" title={file.name}>{file.name}</div>
        <div className="card-meta">
          <span>{formatSize(file.size_bytes)}</span>
          <span>{formatVertices(file.vertex_count)}</span>
        </div>
        <div className="card-timestamp">{formatTimestamp(file.modified_at)}</div>
      </div>
    </div>
  );
};

const FileCardMemo = React.memo(FileCard, (prev, next) => {
  return (
    prev.file.id === next.file.id &&
    prev.file.thumbnail === next.file.thumbnail &&
    prev.selected === next.selected &&
    prev.selectedForBatch === next.selectedForBatch
  );
});

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

const GridItem = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} style={{ display: "flex", flexDirection: "column" }}>
    {children}
  </div>
);

export const FileGrid: React.FC<Props> = ({
  files,
  gridSize,
  activeFileId,
  comparisonFileIds,
  selectedFileIds,
  onToggleFileSelection,
  onSelectFile,
}) => {
  if (files.length === 0) {
    return null;
  }

  return (
    <VirtuosoGrid
      style={{ flex: 1, minHeight: 0 }}
      data={files}
      context={{ gridSize }}
      components={{ List: GridList, Item: GridItem }}
      itemContent={(index, file) => (
        <FileCardMemo
          key={file.id}
          file={file}
          selected={activeFileId === file.id || comparisonFileIds.includes(file.id)}
          selectedForBatch={selectedFileIds.includes(file.id)}
          onToggleSelect={() => onToggleFileSelection(file.id)}
          onClick={() => onSelectFile(file)}
        />
      )}
    />
  );
};
