import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VirtuosoGrid, type VirtuosoGridHandle } from "react-virtuoso";
import { formatSize, formatTimestamp, formatVertices } from "../lib/formatters";
import type { FileRecord } from "../../shared/types";
import { isArchiveEntryPath } from "../../shared/archivePaths";
import { ThumbnailImage } from "./ThumbnailImage";
import { getGridActivationAction, getGridColumnCount, getGridMoveIndex, getGridPageEdgeTarget, getGridTabStopKey, isGridAppend, reconcileGridFocus, sameGridKeys } from "../lib/gridNavigation";
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
  resultCount: number;
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
  focusKey: string;
  tabIndex: number;
  onFocus: (key: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}> = ({ file, selected, selectedForBatch, onToggleSelect, onClick, onDoubleClick, focusKey, tabIndex, onFocus, onKeyDown }) => {
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

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
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
      role="gridcell"
      aria-selected={selectedForBatch}
      aria-current={selected ? "true" : undefined}
      aria-label={isArchiveSummary
        ? `${file.name}, archive with ${archiveModelCount(file)} models`
        : `${file.name}.${file.extension}${selectedForBatch ? ", selected for batch actions" : ""}`}
      tabIndex={tabIndex}
      onFocus={() => onFocus(focusKey)}
      onKeyDown={onKeyDown}
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
          tabIndex={-1}
          aria-label={`${selectedForBatch ? "Remove" : "Add"} ${file.name}.${file.extension} ${selectedForBatch ? "from" : "to"} batch selection`}
          aria-pressed={selectedForBatch}
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
  resultCount: number;
  rovingKey: string | null;
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
      role="grid"
      aria-label={`Library files, ${context?.resultCount ?? 0} results`}
      aria-describedby="library-result-total grid-keyboard-hint"
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown Enter Space Shift+Enter"
      data-roving-key={context?.rovingKey ?? ""}
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
  <div {...props} role="presentation" style={{ display: "flex", flexDirection: "column" }}>
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
  resultCount,
}) => {
  const gridRef = useRef<VirtuosoGridHandle>(null);
  const previousKeysRef = useRef<string[]>([]);
  const pendingPageFocusRef = useRef<number | null>(null);
  const gridHadFocusRef = useRef(false);
  const focusSequenceRef = useRef(0);
  const [rovingKey, setRovingKey] = useState<string | null>(null);
  const rovingKeyRef = useRef(rovingKey);
  rovingKeyRef.current = rovingKey;
  const keys = useMemo(() => files.map(displayItemKey), [files]);
  const markFocusedKey = useCallback((key: string) => {
    gridHadFocusRef.current = true;
    setRovingKey(key);
  }, []);
  const focusItem = useCallback((index: number) => {
    if (index < 0 || index >= files.length) return;
    const sequence = ++focusSequenceRef.current;
    const key = keys[index];
    gridHadFocusRef.current = true;
    setRovingKey(key);
    gridRef.current?.scrollToIndex({ index, align: "center" });
    let attempts = 0;
    const focusRenderedItem = () => {
      if (focusSequenceRef.current !== sequence || attempts++ > 60) return;
      const target = Array.from(document.querySelectorAll<HTMLElement>("#file-grid [data-item-key]"))
        .find((element) => element.dataset.itemKey === key);
      if (target && target.getClientRects().length > 0) {
        target.focus({ preventScroll: true });
      } else {
        requestAnimationFrame(focusRenderedItem);
      }
    };
    requestAnimationFrame(focusRenderedItem);
  }, [files.length, keys]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      gridHadFocusRef.current = Boolean(target?.closest("#file-grid"));
      if (
        !gridHadFocusRef.current
        && target
        && target !== document.body
        && target !== document.documentElement
      ) {
        focusSequenceRef.current += 1;
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    const grid = document.querySelector("#file-grid");
    if (!grid) return;
    const updateRenderedTabStop = () => {
      const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-item-key]"));
      const renderedKeys = cards
        .map((element) => element.dataset.itemKey)
        .filter((key): key is string => Boolean(key));
      const tabStopKey = getGridTabStopKey(rovingKeyRef.current, renderedKeys);
      grid.setAttribute("data-tab-stop-key", tabStopKey ?? "");
      for (const card of cards) {
        card.tabIndex = card.dataset.itemKey === tabStopKey ? 0 : -1;
      }
    };
    const observer = new MutationObserver(updateRenderedTabStop);
    observer.observe(grid, { childList: true, subtree: true });
    updateRenderedTabStop();
    return () => observer.disconnect();
  }, [files.length > 0]);

  useEffect(() => {
    const priorKeys = previousKeysRef.current;
    const hadPriorItems = priorKeys.length > 0;
    if (pendingPageFocusRef.current !== null && files.length > pendingPageFocusRef.current) {
      const targetIndex = pendingPageFocusRef.current;
      pendingPageFocusRef.current = null;
      focusItem(targetIndex);
    } else if (!hadPriorItems && keys.length > 0 && rovingKey === null) {
      setRovingKey(keys[0]);
    } else if (hadPriorItems && keys.length === 0 && gridHadFocusRef.current) {
      setRovingKey(null);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("#search-input")?.focus());
    } else if (hadPriorItems && !sameGridKeys(priorKeys, keys)) {
      const reconciled = reconcileGridFocus(priorKeys, keys, rovingKey);
      if (reconciled.key !== rovingKey) setRovingKey(reconciled.key);
      if (gridHadFocusRef.current && reconciled.key && !isGridAppend(priorKeys, keys)) {
        focusItem(reconciled.index);
      }
    }
    previousKeysRef.current = keys;
  }, [files, focusItem, keys, rovingKey]);

  const handleCardKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget || target.isContentEditable) return;
    const key = event.key;
    const itemKey = event.currentTarget.dataset.itemKey;
    const currentIndex = itemKey ? keys.indexOf(itemKey) : -1;
    if (currentIndex < 0) return;

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(key)) {
      event.preventDefault();
      const list = document.querySelector<HTMLElement>("#file-grid");
      const columns = list ? getGridColumnCount(getComputedStyle(list).gridTemplateColumns) : 1;
      let pageSize = columns;
      const scroller = document.querySelector<HTMLElement>("[data-virtuoso-scroller]");
      const card = list?.querySelector<HTMLElement>("[data-item-key]");
      if (scroller && card) {
        const rows = Math.max(1, Math.floor(scroller.clientHeight / Math.max(1, card.getBoundingClientRect().height)));
        pageSize = rows * columns;
      }
      const nextIndex = getGridMoveIndex(currentIndex, keys.length, columns, key as Parameters<typeof getGridMoveIndex>[3], pageSize);
      const pageEdgeTarget = getGridPageEdgeTarget(currentIndex, keys.length, columns, key as Parameters<typeof getGridPageEdgeTarget>[3], pageSize, hasMore);
      if (pageEdgeTarget !== null) {
        pendingPageFocusRef.current = pageEdgeTarget;
        onEndReached();
      } else if (nextIndex !== currentIndex) {
        focusItem(nextIndex);
      }
      return;
    }

    if (key === "Enter" || key === " ") {
      event.preventDefault();
      const file = files[currentIndex];
      const action = getGridActivationAction(
        key,
        event.shiftKey,
        selectedFileIds.size > 0,
        !isArchiveDisplay(file),
      );
      if (action === "toggle-selection" && !isArchiveDisplay(file)) {
        onToggleFileSelection(file as FileRecord);
      } else if (action === "preview") {
        onSelectFile(file);
      }
    }
  }, [files, focusItem, hasMore, keys, onEndReached, onSelectFile, onToggleFileSelection, selectedFileIds.size]);

  const context = useMemo(() => ({
    gridSize,
    pageRefreshing,
    pageLoadingNext,
    pageError,
    hasMore,
    onRetry,
    resultCount,
    rovingKey,
  }), [gridSize, pageRefreshing, pageLoadingNext, pageError, hasMore, onRetry, resultCount, rovingKey]);
  const computeItemKey = useCallback((_index: number, item: DisplayFileRecord) => displayItemKey(item), []);
  const itemContent = useCallback((_index: number, file: DisplayFileRecord) => (
      <FileCardMemo
      file={file}
      selected={activeItemKey === displayItemKey(file) || comparisonItemKeys.has(displayItemKey(file))}
      selectedForBatch={!isArchiveDisplay(file) && selectedFileIds.has(file.id)}
      onToggleSelect={onToggleFileSelection}
      onClick={onSelectFile}
        onDoubleClick={onOpenArchive}
        focusKey={displayItemKey(file)}
        tabIndex={rovingKey === displayItemKey(file) ? 0 : -1}
        onFocus={markFocusedKey}
        onKeyDown={handleCardKeyDown}
    />
  ), [activeItemKey, comparisonItemKeys, handleCardKeyDown, markFocusedKey, onOpenArchive, onSelectFile, onToggleFileSelection, rovingKey, selectedFileIds]);

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
      ref={gridRef}
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
