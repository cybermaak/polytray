import React, { useRef, useEffect, useState, useCallback, useMemo, useReducer } from "react";
import { formatDimensions, formatSize, formatNumber } from "../lib/formatters";
import type { FileRecord, ModelDimensions } from "../../shared/types";
import type { LibraryArchiveItem, LibraryQueryClient } from "../../shared/libraryQuery";
import type { PreviewTarget } from "../../shared/previewTarget";
import { normalizeFileTags, parseStoredFileTags } from "../../shared/fileTags";
import type { CollectionRecord } from "../../shared/libraryCollections";
import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import type { ThumbnailQuality } from "../../shared/settings";
import { normalizePanelPreferences } from "../../shared/panelPreferences";
import {
  type DisplayFileRecord,
  isArchiveSummaryRecord,
  isLibraryArchiveDisplayRecord,
} from "../lib/archiveDisplay";
import { AppIcon } from "./AppIcon";
import { ThumbnailImage } from "./ThumbnailImage";
import { createPreviewGeometryIdentity, previewStateReducer } from "../lib/previewState";
import { createArchivePreviewPages, type ArchivePreviewPage } from "../lib/archivePreviewPages";
import {
  initViewer,
  loadModelWithWorker,
  toggleWireframe,
  resetCamera,
  toggleGrid,
  notifyViewerResize,
} from "../lib/viewer";

interface Props {
  file: FileRecord | null;
  item: DisplayFileRecord | null;
  target?: PreviewTarget | null;
  libraryQueryClient?: LibraryQueryClient;
  showGrid: boolean;
  thumbnailColor: string;
  thumbQuality: ThumbnailQuality;
  collections: CollectionRecord[];
  onFileChange?: (file: FileRecord) => void;
  onCreateCollection: (name: string, filePaths: string[]) => void;
  onAddFilesToCollection: (collectionId: string, filePaths: string[]) => void;
  onClose: () => void;
  preferredWidth: number;
  effectiveWidth: number;
  overlay: boolean;
  onPreferredWidthChange: (width: number) => void;
}

interface ArchivePreviewView {
  key: string;
  page: ArchivePreviewPage | null;
  selectedIndex: number;
  loading: boolean;
  error: string | null;
  requestedOffset: number;
  requestedIndex: number;
  requestedFilePath: string | null;
}

const EMPTY_ARCHIVE_VIEW: ArchivePreviewView = {
  key: '', page: null, selectedIndex: 0, loading: false, error: null, requestedOffset: 0, requestedIndex: 0, requestedFilePath: null,
};

function targetFromLegacyProps(file: FileRecord | null, item: DisplayFileRecord | null): PreviewTarget | null {
  if (file) return { kind: 'file', file };
  if (!item) return null;
  if (isLibraryArchiveDisplayRecord(item)) {
    return {
      kind: 'archive',
      archive: item.source,
      query: {
        sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
        collectionPaths: null, limit: 24, offset: 0,
      },
    };
  }
  if (!isArchiveSummaryRecord(item)) return { kind: 'file', file: item };
  const archive: LibraryArchiveItem = {
    kind: 'archive',
    key: `archive:${item.path}`,
    archivePath: item.path,
    name: item.name,
    // A legacy display summary contains only page samples. The exact count is
    // filled by the archive-scoped file query below.
    modelCount: 0,
    vertexCount: item.vertex_count,
    faceCount: item.face_count,
    sizeBytes: item.size_bytes,
    thumbnailSamples: item.entries.slice(0, 4),
  };
  return {
    kind: 'archive',
    archive,
    query: {
      sort: 'name', direction: 'ASC', extension: null, folder: item.directory === '.' ? null : item.directory, search: '',
      collectionPaths: null, limit: 24, offset: 0,
    },
  };
}

function archivePreviewIdentity(target: Extract<PreviewTarget, { kind: 'archive' }>): string {
  const { limit: _limit, offset: _offset, expectedBrowseRevision: _revision, archivePath: _queryArchivePath, collectionPaths, ...scope } = target.query;
  return JSON.stringify([
    target.archive.archivePath,
    { ...scope, collectionPaths: collectionPaths === null ? null : [...collectionPaths].sort() },
  ]);
}

function waitForViewerContainer(container: HTMLElement, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (container.clientWidth > 0 && container.clientHeight > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      signal.removeEventListener('abort', onAbort);
      resolve(ready);
    };
    const checkSize = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) finish(true);
    };
    const onAbort = () => finish(false);
    const observer = new ResizeObserver(checkSize);
    observer.observe(container);
    signal.addEventListener('abort', onAbort, { once: true });
    checkSize();
  });
}

export const PreviewPanel: React.FC<Props> = ({
  file,
  item,
  target,
  libraryQueryClient,
  showGrid,
  thumbnailColor,
  thumbQuality,
  collections,
  onFileChange,
  onCreateCollection,
  onAddFilesToCollection,
  onClose,
  preferredWidth,
  effectiveWidth,
  overlay,
  onPreferredWidthChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);
  const lastViewerSize = useRef<{ width: number; height: number } | null>(null);
  const viewerSessionRef = useRef<ReturnType<typeof initViewer> | null>(null);
  const thumbQualityRef = useRef(thumbQuality);
  const activeLoadRef = useRef<AbortController | null>(null);
  const loadTokenRef = useRef(0);
  const currentFileRef = useRef<FileRecord | null>(null);
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;
  useEffect(() => {
    thumbQualityRef.current = thumbQuality;
  }, [thumbQuality]);
  const archiveRequestRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [loadState, dispatchLoadState] = useReducer(previewStateReducer, { status: 'idle' } as const);
  const [retryNonce, setRetryNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [savedTags, setSavedTags] = useState<string[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const activeTarget = target !== undefined ? target : targetFromLegacyProps(file, item);
  const archiveTarget = activeTarget?.kind === 'archive' ? activeTarget : null;
  const archiveKey = archiveTarget ? archivePreviewIdentity(archiveTarget) : '';
  const archiveTargetRef = useRef(archiveTarget);
  archiveTargetRef.current = archiveTarget;
  const defaultQueryClient = useMemo<LibraryQueryClient>(() => ({
    getLibraryPage: (query) => window.polytray.getLibraryPage(query),
  }), []);
  const pageClient = libraryQueryClient ?? defaultQueryClient;
  const pageClientRef = useRef(pageClient);
  pageClientRef.current = pageClient;
  const stablePageClient = useMemo<LibraryQueryClient>(() => ({
    getLibraryPage: (query) => pageClientRef.current.getLibraryPage(query),
  }), []);
  const archivePages = useMemo(() => {
    const currentTarget = archiveTargetRef.current;
    return currentTarget ? createArchivePreviewPages(currentTarget, stablePageClient) : null;
  }, [archiveKey, stablePageClient]);
  const [archiveView, setArchiveView] = useState<ArchivePreviewView>(EMPTY_ARCHIVE_VIEW);
  const archiveViewRef = useRef(archiveView);
  archiveViewRef.current = archiveView;
  const currentArchiveView = archiveKey && archiveView.key === archiveKey ? archiveView : null;
  const archiveFiles = currentArchiveView?.page?.files ?? [];
  const currentFile = archiveTarget
    ? archiveFiles[currentArchiveView?.selectedIndex ?? 0] ?? null
    : activeTarget?.kind === 'file' ? activeTarget.file : null;
  currentFileRef.current = currentFile;
  const geometryIdentity = currentFile ? createPreviewGeometryIdentity(currentFile) : null;
  const stateForCurrentFile = geometryIdentity && loadState.status !== 'idle' && loadState.identity === geometryIdentity
    ? loadState
    : geometryIdentity ? { status: 'loading' as const, identity: geometryIdentity, token: -1, progress: -1 } : { status: 'idle' as const };
  const currentCollections = React.useMemo(
    () =>
      currentFile
        ? collections.filter((collection) => collection.filePaths.includes(currentFile.path))
        : [],
    [collections, currentFile],
  );

  const loadArchivePage = useCallback(async (offset: number, selectedIndex: number, selectedFilePath: string | null = null) => {
    if (!archivePages || !archiveKey) return;
    const request = ++archiveRequestRef.current;
    setArchiveView((previous) => {
      const current = previous.key === archiveKey ? previous : EMPTY_ARCHIVE_VIEW;
      return {
        ...current,
        key: archiveKey,
        loading: true,
        error: null,
        requestedOffset: offset,
        requestedIndex: selectedIndex,
        requestedFilePath: selectedFilePath,
      };
    });
    try {
      const page = await archivePages.loadPage(offset);
      if (request !== archiveRequestRef.current) return;
      const matchingIndex = selectedFilePath ? page.files.findIndex((record) => record.path === selectedFilePath) : -1;
      setArchiveView({
        key: archiveKey,
        page,
        selectedIndex: page.files.length
          ? matchingIndex >= 0 ? matchingIndex : Math.min(Math.max(0, selectedIndex), page.files.length - 1)
          : 0,
        loading: false,
        error: null,
        requestedOffset: offset,
        requestedIndex: selectedIndex,
        requestedFilePath: selectedFilePath,
      });
    } catch (error: unknown) {
      if (request !== archiveRequestRef.current) return;
      setArchiveView((previous) => {
        const current = previous.key === archiveKey ? previous : EMPTY_ARCHIVE_VIEW;
        return {
          ...current,
          key: archiveKey,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load archive models.',
          requestedOffset: offset,
          requestedIndex: selectedIndex,
          requestedFilePath: selectedFilePath,
        };
      });
    }
  }, [archiveKey, archivePages]);

  useEffect(() => {
    if (!archiveKey || !archivePages) {
      setArchiveView(EMPTY_ARCHIVE_VIEW);
      return;
    }
    void loadArchivePage(0, 0);
    return () => {
      archiveRequestRef.current++;
      archivePages.dispose();
    };
  }, [archiveKey, archivePages, loadArchivePage]);

  useEffect(() => {
    if (!archiveKey || !archivePages) return;
    return window.polytray.onThumbnailReady((data) => {
      const contentRevision = data.contentRevision;
      archivePages.updateThumbnail(data.fileId, contentRevision, data.thumbnailPath);
      setArchiveView((previous) => {
        if (previous.key !== archiveKey || !previous.page) return previous;
        let changed = false;
        const files = previous.page.files.map((record) => {
          if (record.id !== data.fileId || record.content_revision !== contentRevision) return record;
          changed = true;
          return { ...record, thumbnail: data.thumbnailPath, thumbnail_failed: 0 };
        });
        return changed ? { ...previous, page: { ...previous.page, files } } : previous;
      });
    });
  }, [archiveKey, archivePages]);

  const handleArchiveStep = useCallback((direction: -1 | 1) => {
    const view = archiveView.key === archiveKey ? archiveView : null;
    const page = view?.page;
    if (!page || view?.loading) return;
    const nextIndex = view.selectedIndex + direction;
    if (nextIndex >= 0 && nextIndex < page.files.length) {
      setArchiveView({ ...view, selectedIndex: nextIndex });
      return;
    }
    if (direction > 0 && page.nextOffset !== null) {
      void loadArchivePage(page.nextOffset, 0);
    } else if (direction < 0 && page.offset > 0 && archivePages) {
      const previousOffset = Math.max(0, page.offset - archivePages.pageSize);
      void loadArchivePage(previousOffset, archivePages.pageSize - 1);
    }
  }, [archiveKey, archivePages, archiveView, loadArchivePage]);

  const handleArchiveRetry = useCallback(() => {
    if (!archiveKey || archiveView.key !== archiveKey || !archiveView.error) return;
    void loadArchivePage(archiveView.requestedOffset, archiveView.requestedIndex, archiveView.requestedFilePath);
  }, [archiveKey, archiveView, loadArchivePage]);

  useEffect(() => {
    if (!archiveKey || !archivePages) return;
    return window.polytray.onLibraryChanged((change) => {
      if (!change.rowsChanged && !change.annotationsChanged) return;
      const previous = archiveViewRef.current;
      const page = previous.key === archiveKey ? previous.page : null;
      const selectedFile = page?.files[previous.selectedIndex];
      archivePages.invalidate(change.browseRevision);
      void loadArchivePage(page?.offset ?? 0, previous.selectedIndex, selectedFile?.path ?? null);
    });
  }, [archiveKey, archivePages, loadArchivePage]);

  const previewIsActive = activeTarget !== null;
  useEffect(() => {
    if (!previewIsActive) return;
    return () => {
      activeLoadRef.current?.abort();
      activeLoadRef.current = null;
      const session = viewerSessionRef.current;
      viewerSessionRef.current = null;
      session?.dispose();
    };
  }, [previewIsActive]);

  // Keep viewer canvas in sync when the container is resized (e.g. panel drag)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      const container = containerRef.current;
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      const previous = lastViewerSize.current;
      if (previous && previous.width === width && previous.height === height) return;
      lastViewerSize.current = { width, height };
      notifyViewerResize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Load geometry only when its stable file identity changes or the user retries.
  useEffect(() => {
    if (!geometryIdentity) {
      dispatchLoadState({ type: 'reset' });
      return;
    }
    const loadToken = ++loadTokenRef.current;
    const controller = new AbortController();
    activeLoadRef.current = controller;
    dispatchLoadState({ type: 'start', identity: geometryIdentity, token: loadToken });
    setWireframe(false);
    setExpanded(false);

    void (async () => {
      try {
        const fileToLoad = currentFileRef.current;
        const container = containerRef.current;
        if (!fileToLoad || !container || !(await waitForViewerContainer(container, controller.signal))) return;
        if (controller.signal.aborted) return;
        let session = viewerSessionRef.current;
        if (!session || session.isDisposed) {
          session = initViewer(container);
          viewerSessionRef.current = session;
          toggleGrid(showGridRef.current);
        }
        await loadModelWithWorker(
          fileToLoad.path,
          fileToLoad.extension,
          fileToLoad.name,
          fileToLoad.content_revision,
          controller.signal,
          (progress) => {
            dispatchLoadState({ type: 'progress', identity: geometryIdentity, token: loadToken, progress });
          },
        );
        if (controller.signal.aborted || session.isDisposed) return;
        dispatchLoadState({ type: 'ready', identity: geometryIdentity, token: loadToken });
      } catch (error: unknown) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
        console.error('Failed to load model:', error);
        dispatchLoadState({
          type: 'error', identity: geometryIdentity, token: loadToken,
          message: "Couldn't load this model. Check the file and retry.",
        });
      }
    })();

    return () => {
      controller.abort();
      if (activeLoadRef.current === controller) activeLoadRef.current = null;
    };
  }, [geometryIdentity, retryNonce]);

  useEffect(() => {
    if (previewIsActive && viewerSessionRef.current) toggleGrid(showGrid);
  }, [previewIsActive, showGrid]);

  useEffect(() => {
    if (!currentFile || !geometryIdentity || stateForCurrentFile.status !== 'ready' || currentFile.thumbnail) return;
    const thumbnailSettings = {
      thumbnail_timeout: DEFAULT_APP_SETTINGS.thumbnail_timeout,
      scanning_batch_size: DEFAULT_APP_SETTINGS.scanning_batch_size,
      watcher_stability: DEFAULT_APP_SETTINGS.watcher_stability,
      page_size: DEFAULT_APP_SETTINGS.page_size,
      thumbnailColor,
      thumbQuality: thumbQualityRef.current,
    };
    void window.polytray.requestThumbnailGeneration(currentFile.path, currentFile.extension, thumbnailSettings);
  }, [currentFile?.thumbnail, currentFile?.path, currentFile?.extension, geometryIdentity, stateForCurrentFile.status, thumbnailColor, thumbQuality]);

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
    activeLoadRef.current?.abort();
    activeLoadRef.current = null;
    const session = viewerSessionRef.current;
    viewerSessionRef.current = null;
    session?.dispose();
    onClose();
  }, [onClose]);

  const handleSaveTags = useCallback(async () => {
    if (!currentFile) return;
    const fileId = currentFile.id;
    const normalized = normalizeFileTags(tagsInput.split(","));
    const updated = (await window.polytray.updateFileMetadata({
      id: fileId,
      tags: normalized,
    })) as FileRecord;
    onFileChange?.(updated);
    if (currentFileRef.current?.id === fileId) {
      setSavedTags(normalized);
      setTagsInput(normalized.join(", "));
    }
    setArchiveView((previous) => {
      if (!archiveKey || previous.key !== archiveKey || !previous.page) return previous;
      let changed = false;
      const files = previous.page.files.map((record) => {
        if (record.id !== fileId) return record;
        changed = true;
        return updated;
      });
      return changed ? { ...previous, page: { ...previous.page, files } } : previous;
    });
  }, [archiveKey, currentFile, onFileChange, tagsInput]);

  const handleSaveNotes = useCallback(async () => {
    if (!currentFile) return;
    const fileId = currentFile.id;
    const updated = (await window.polytray.updateFileMetadata({
      id: fileId,
      notes: notesInput,
    })) as FileRecord;
    onFileChange?.(updated);
    if (currentFileRef.current?.id === fileId) setNotesInput(updated.notes ?? '');
    setArchiveView((previous) => {
      if (!archiveKey || previous.key !== archiveKey || !previous.page) return previous;
      let changed = false;
      const files = previous.page.files.map((record) => {
        if (record.id !== fileId) return record;
        changed = true;
        return updated;
      });
      return changed ? { ...previous, page: { ...previous.page, files } } : previous;
    });
  }, [archiveKey, currentFile, notesInput, onFileChange]);

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

  useEffect(() => {
    const nextTags = parseStoredFileTags(currentFile?.tags);
    setSavedTags(nextTags);
    setTagsInput(nextTags.join(", "));
    setNotesInput(currentFile?.notes ?? '');
  }, [currentFile?.id, currentFile?.tags, currentFile?.notes]);

  useEffect(() => {
    setSelectedCollectionId("");
    setNewCollectionName("");
  }, [currentFile?.id]);

  useEffect(() => {
    if (!selectedCollectionId) {
      return;
    }

    if (currentCollections.some((collection) => collection.id === selectedCollectionId)) {
      setSelectedCollectionId("");
    }
  }, [currentCollections, selectedCollectionId]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelRef.current?.getBoundingClientRect().width ?? effectiveWidth;
    setIsDragging(true);

    const onMouseMove = (ev: MouseEvent) => {
      const delta = dragStartX.current - ev.clientX;
      if (delta === 0) return;
      const next = normalizePanelPreferences({
        previewWidth: dragStartWidth.current + delta,
      }).previewWidth;
      onPreferredWidthChange(next);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [preferredWidth, effectiveWidth, onPreferredWidthChange]);

  const panelClasses = [
    "preview-panel",
    !previewIsActive ? "hidden" : "",
    expanded ? "expanded" : "",
    overlay && !expanded ? "overlay" : "",
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

  const handleRetryPreview = useCallback(() => {
    if (geometryIdentity) setRetryNonce((retry) => retry + 1);
  }, [geometryIdentity]);
  const archivePath = archiveTarget?.archive.archivePath ?? null;
  const archiveName = archiveTarget?.archive.name ?? '';
  const archivePage = currentArchiveView?.page ?? null;
  const archiveTotal = archivePage?.totalModels ?? (archiveTarget?.archive.modelCount || null);
  const archiveSelectedNumber = archivePage && currentFile
    ? archivePage.offset + (currentArchiveView?.selectedIndex ?? 0) + 1
    : null;
  const progress = stateForCurrentFile.status === 'loading' ? stateForCurrentFile.progress : -1;
  const modelLoadError = stateForCurrentFile.status === 'error' ? stateForCurrentFile.message : null;

  return (
    <aside
      id="preview-panel"
      ref={panelRef}
      className={panelClasses}
      style={!expanded ? { width: effectiveWidth } : undefined}
    >
      {!expanded && (
        <div
          className={`preview-resize-handle${isDragging ? " dragging" : ""}`}
          onMouseDown={handleResizeMouseDown}
        />
      )}
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
        className={`viewer-multi-model${archiveTarget ? "" : " hidden"}`}
        id="archive-preview-models"
      >
        {archiveTarget && (
          <button
            id="archive-preview-previous"
            type="button"
            className="multi-model-thumb"
            aria-label="Previous archive model"
            title="Previous model"
            disabled={!archivePage || currentArchiveView?.loading || (!archivePage.offset && !currentArchiveView?.selectedIndex)}
            onClick={() => handleArchiveStep(-1)}
          >
            ‹
          </button>
        )}
        {archivePage?.files.map((entry, index) => (
          <button
            key={entry.path}
            type="button"
            className={`multi-model-thumb${currentArchiveView?.selectedIndex === index ? " active" : ""}`}
            disabled={currentArchiveView?.loading}
            onClick={() => setArchiveView({ ...currentArchiveView!, selectedIndex: index })}
            title={`${entry.name}.${entry.extension}`}
          >
            {entry.thumbnail
              ? <ThumbnailImage thumbnailPath={entry.thumbnail} identity={entry.id} alt={`${entry.name}.${entry.extension}`} />
              : <span className="archive-thumb-fallback">{entry.extension.toUpperCase()}</span>}
          </button>
        ))}
        {archiveTarget && (
          <>
            <span id="archive-preview-count" aria-live="polite">
              {currentArchiveView?.error && !archivePage
                ? 'Archive models unavailable'
                : archivePage
                  ? `${archiveSelectedNumber ?? 0} of ${archivePage.totalModels} models`
                  : 'Loading archive models…'}
            </span>
            <button
              id="archive-preview-next"
              type="button"
              className="multi-model-thumb"
              aria-label="Next archive model"
              title="Next model"
              disabled={!archivePage || currentArchiveView?.loading ||
                (currentArchiveView!.selectedIndex >= archivePage.files.length - 1 && archivePage.nextOffset === null)}
              onClick={() => handleArchiveStep(1)}
            >
              ›
            </button>
          </>
        )}
        {currentArchiveView?.error && (
          <span role="alert">
            {currentArchiveView.error}
            <button type="button" id="archive-preview-retry" onClick={handleArchiveRetry}>Retry</button>
          </span>
        )}
      </div>

      <div className="viewer-multi-model hidden" id="viewer-multi-model" />

      <div className="viewer-stage">
        <div
          ref={containerRef}
          id="viewer-container"
          className="viewer-container"
        />
        {modelLoadError && (
          <div
            id="viewer-error"
            role="alert"
            style={{
              position: 'absolute', inset: 0, zIndex: 11,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: 24, textAlign: 'center',
              background: 'color-mix(in srgb, var(--bg-base) 94%, black 6%)',
              color: 'var(--text-primary)',
            }}
          >
            <span>{modelLoadError}</span>
            <button id="btn-retry-preview" className="btn-copy-path" onClick={handleRetryPreview}>Retry</button>
          </div>
        )}
      </div>

      <div
        id="viewer-loading"
        className={`viewer-loading${stateForCurrentFile.status === 'loading' ? "" : " hidden"}`}
      >
        {(() => {
            const radius = 20;
            const circumference = 2 * Math.PI * radius;
            const isIndeterminate = progress < 0;
            const pct = isIndeterminate ? 25 : progress;
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
                {!isIndeterminate && <span className="ring-label">{progress}%</span>}
              </div>
            );
          })()}
        <span>
          {progress >= 0
              ? `Loading model (${progress}%)...`
              : "Processing 3D data..."}
        </span>
      </div>

      <div className="viewer-footer">
        <div className="viewer-title">
          <h2 id="viewer-filename" style={{ userSelect: "text" }}>
            {archiveTarget
              ? archiveName
              : currentFile
                ? `${currentFile.name}.${currentFile.extension}`
                : "model_name.stl"}
          </h2>
          <div
            className="viewer-path"
            id="viewer-path"
            title={archivePath || currentFile?.path || ""}
          >
            <span
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {archivePath || currentFile?.path || ""}
            </span>
            {(archiveTarget || currentFile) && (
              <button
                className="btn-copy-path"
                title="Copy full path"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(archivePath || currentFile?.path || "");
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
            {archiveTarget
              ? `${archiveTotal ?? '…'} models${currentFile ? ` | Viewing: ${currentFile.name}.${currentFile.extension}` : ""}`
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
            <div className="viewer-tags-header">Notes</div>
            <div className="viewer-tag-editor" style={{ alignItems: 'stretch' }}>
              <textarea
                id="file-notes-input"
                rows={3}
                value={notesInput}
                placeholder="Add a note about this model"
                onChange={(event) => setNotesInput(event.target.value)}
                disabled={!currentFile}
                style={{
                  minWidth: 0, flex: 1, resize: 'vertical',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  padding: '8px 10px', fontSize: 12,
                }}
              />
              <button
                id="save-file-notes"
                className="btn-copy-path"
                onClick={handleSaveNotes}
                disabled={!currentFile}
              >
                Save Notes
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
