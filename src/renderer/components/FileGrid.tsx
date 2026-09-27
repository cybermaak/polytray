import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import { formatSize, formatTimestamp, formatVertices } from "../lib/formatters";
import type { FileRecord } from "../../shared/types";
import { isArchiveEntryPath } from "../../shared/archivePaths";
import { ThumbnailImage } from "./ThumbnailImage";
import {
  type DisplayFileRecord,
  isLibraryArchiveDisplayRecord,
  isArchiveSummaryRecord,
} from "../lib/archiveDisplay";

interface Props {
  files: DisplayFileRecord[];
  gridSize: "small" | "medium" | "large";
  activeItemKey: string | null;
  comparisonItemKeys: ReadonlySet<string>;
  selectedFileIds: ReadonlySet<number>;
  onToggleFileSelection: (file: FileRecord) => void;
  onSelectFile: (file: DisplayFileRecord) => void;
  onOpenArchive: (archivePath: string) => void;
  pageLoading: boolean;
  pageRefreshing: boolean;
  pageLoadingNext: boolean;
  pageError: string | null;
  hasMore: boolean;
  onEndReached: () => void;
  onRetry: () => void;
}

function isArchiveDisplay(file: DisplayFileRecord): file is Extract<DisplayFileRecord, { kind: "archive-summary" }> {
  return isArchiveSummaryRecord(file) || isLibraryArchiveDisplayRecord(file);
}

function archiveThumbnailSamples(file: Extract<DisplayFileRecord, { kind: "archive-summary" }>) {
  return isLibraryArchiveDisplayRecord(file) ? file.thumbnailSamples : file.entries.slice(0, 4);
}

function archiveModelCount(file: Extract<DisplayFileRecord, { kind: "archive-summary" }>) {
  return isLibraryArchiveDisplayRecord(file) ? file.modelCount : file.entries.length;
}

function archivePath(file: Extract<DisplayFileRecord, { kind: "archive-summary" }>) {
  return isLibraryArchiveDisplayRecord(file) ? file.archivePath : file.path;
}

function displayItemKey(file: DisplayFileRecord) {
  if (isLibraryArchiveDisplayRecord(file)) return file.key;
  if (isArchiveSummaryRecord(file)) return `archive:${file.path}`;
  return `file:${file.id}`;
}

const ArchiveThumbnailGrid: React.FC<{ files: FileRecord[] }> = ({ files }) => (
  <div className="archive-thumbnail-grid">
    {files.slice(0, 4).map((file) => (
      <ThumbnailImage key={file.id} thumbnailPath={file.thumbnail} identity={file.content_revision} alt="" />
    ))}
  </div>
);

const FileCard: React.FC<{
  file: DisplayFileRecord;
  selected: boolean;
  selectedForBatch: boolean;
  onToggleSelect: (file: FileRecord) => void;
  onClick: (file: DisplayFileRecord) => void;
  onDoubleClick: (archivePath: string) => void;
}> = ({ file, selected, selectedForBatch, onToggleSelect, onClick, onDoubleClick }) => {
  const isArchiveSummary = isArchiveDisplay(file);
  const fileRecord = isArchiveSummary ? null : file as FileRecord;
  const extClass = file.extension === "3mf" ? "threemf" : file.extension;
  const itemPath = isLibraryArchiveDisplayRecord(file) ? file.archivePath : file.path;
  const isArchiveEntry = fileRecord ? isArchiveEntryPath(fileRecord.path) : false;
  const clickTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  const handleCardClick = () => {
    if (!isArchiveSummary) {
      onClick(file);
      return;
    }

    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
    }

    clickTimeoutRef.current = window.setTimeout(() => {
      clickTimeoutRef.current = null;
      onClick(file);
    }, 180);
  };

  const handleCardDoubleClick = () => {
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    if (isArchiveDisplay(file)) onDoubleClick(archivePath(file));
  };

  return (
    <div
      className={`file-card${selected ? " selected" : ""}${isArchiveSummary ? " archive-summary" : ""}`}
      data-item-key={displayItemKey(file)}
      {...(fileRecord ? { "data-file-id": fileRecord.id } : {})}
      title={itemPath}
      onClick={handleCardClick}
      onDoubleClick={handleCardDoubleClick}
      draggable={!isArchiveEntry && !isArchiveSummary}
      onDragStart={(e) => {
        if (isArchiveEntry || isArchiveSummary) return;
        e.preventDefault();
        if (fileRecord) window.polytray.startDrag(fileRecord.path);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (isArchiveSummary || isArchiveEntry) {
          window.polytray.showArchiveContextMenu(itemPath, isArchiveSummary);
        } else {
          window.polytray.showContextMenu(itemPath);
        }
      }}
    >
      {!isArchiveSummary && (
        <button
          type="button"
          className={`file-select-toggle${selectedForBatch ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (fileRecord) onToggleSelect(fileRecord);
          }}
        >
          {selectedForBatch ? "✓" : ""}
        </button>
      )}
      <div className="card-thumbnail">
        {!isArchiveSummary && !file.thumbnail && (
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
        {isArchiveSummary ? (
          <ArchiveThumbnailGrid files={archiveThumbnailSamples(file)} />
        ) : (
          <ThumbnailImage thumbnailPath={fileRecord?.thumbnail} identity={fileRecord?.content_revision} alt="" />
        )}
        <span className={`card-ext-badge ${extClass}`}>{file.extension.toUpperCase()}</span>
        {isArchiveEntry && (
          <span className="card-source-badge" title="Model stored inside a zip archive">
            ZIP
          </span>
        )}
        {isArchiveSummary && (
          <span className="card-source-badge" title={`${archiveModelCount(file)} models in archive`}>
            {archiveModelCount(file)} models
          </span>
        )}
      </div>
      <div className="card-info">
        <div className="card-name" title={file.name}>{file.name}</div>
        <div className="card-meta">
          {isArchiveSummary ? (
            <>
              <span>{formatSize(file.size_bytes)}</span>
            <span>{archiveModelCount(file)} models</span>
            </>
          ) : (
            <>
              <span>{formatSize(file.size_bytes)}</span>
              <span>{formatVertices(file.vertex_count)}</span>
            </>
          )}
        </div>
        <div className="card-timestamp">{fileRecord ? formatTimestamp(fileRecord.modified_at) : "Archive"}</div>
      </div>
    </div>
  );
};

const FileCardMemo = React.memo(FileCard);

interface GridContext {
  gridSize: string;
  pageRefreshing: boolean;
  pageLoadingNext: boolean;
  pageError: string | null;
  hasMore: boolean;
  onRetry: () => void;
}

const GridFooter: React.FC<{ context?: GridContext }> = ({ context }) => {
  if (!context) return null;
  if (context.pageError) {
    return (
      <div className="library-page-footer" role="status" aria-live="polite">
        <span>{context.pageError}</span>
        <button type="button" className="btn-secondary" onClick={context.onRetry}>Retry</button>
      </div>
    );
  }
  if (context.pageRefreshing) return <div className="library-page-footer" role="status">Refreshing results…</div>;
  if (context.pageLoadingNext) return <div className="library-page-footer" role="status">Loading more…</div>;
  return context.hasMore ? <div className="library-page-footer" aria-hidden="true" /> : null;
};

const GridList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { context?: GridContext }
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
  activeItemKey,
  comparisonItemKeys,
  selectedFileIds,
  onToggleFileSelection,
  onSelectFile,
  onOpenArchive,
  pageLoading,
  pageRefreshing,
  pageLoadingNext,
  pageError,
  hasMore,
  onEndReached,
  onRetry,
}) => {
  const context = useMemo(() => ({
    gridSize,
    pageRefreshing,
    pageLoadingNext,
    pageError,
    hasMore,
    onRetry,
  }), [gridSize, pageRefreshing, pageLoadingNext, pageError, hasMore, onRetry]);
  const computeItemKey = useCallback((_index: number, item: DisplayFileRecord) => displayItemKey(item), []);
  const itemContent = useCallback((_index: number, file: DisplayFileRecord) => (
    <FileCardMemo
      file={file}
      selected={activeItemKey === displayItemKey(file) || comparisonItemKeys.has(displayItemKey(file))}
      selectedForBatch={!isArchiveDisplay(file) && selectedFileIds.has(file.id)}
      onToggleSelect={onToggleFileSelection}
      onClick={onSelectFile}
      onDoubleClick={onOpenArchive}
    />
  ), [activeItemKey, comparisonItemKeys, onOpenArchive, onSelectFile, onToggleFileSelection, selectedFileIds]);

  if (files.length === 0) {
    if (pageError) {
      return (
        <div className="library-page-empty-status" role="status" aria-live="polite">
          <span>{pageError}</span>
          <button type="button" className="btn-secondary" onClick={onRetry}>Retry</button>
        </div>
      );
    }
    if (pageLoading || pageRefreshing) {
      return <div className="library-page-empty-status" role="status">Loading library…</div>;
    }
    return null;
  }

  return (
    <VirtuosoGrid
      style={{ flex: 1, minHeight: 0 }}
      data={files}
      context={context}
      components={{ List: GridList, Item: GridItem, Footer: GridFooter }}
      computeItemKey={computeItemKey}
      endReached={hasMore ? onEndReached : undefined}
      itemContent={itemContent}
    />
  );
};
