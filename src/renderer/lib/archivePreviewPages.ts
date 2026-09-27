import type { LibraryPageResult, LibraryQueryClient } from '../../shared/libraryQuery';
import type { FileRecord } from '../../shared/types';
import type { PreviewTarget } from '../../shared/previewTarget';

export const DEFAULT_ARCHIVE_PREVIEW_PAGE_SIZE = 24;
export const DEFAULT_ARCHIVE_PREVIEW_MAX_CACHED_PAGES = 3;

export interface ArchivePreviewPage {
  offset: number;
  files: FileRecord[];
  totalModels: number;
  nextOffset: number | null;
  revision: number;
}

export interface ArchivePreviewPages {
  readonly pageSize: number;
  readonly cachedPageCount: number;
  loadPage(offset: number): Promise<ArchivePreviewPage>;
  invalidate(browseRevision: number): void;
  updateThumbnail(fileId: number, contentRevision: number, thumbnailPath: string): void;
  dispose(): void;
}

export interface ArchivePreviewPagesOptions {
  pageSize?: number;
  maxCachedPages?: number;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return value !== undefined && Number.isSafeInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normalizeQueryLimit(target: Extract<PreviewTarget, { kind: 'archive' }>, pageSize?: number) {
  const configured = boundedInteger(pageSize, DEFAULT_ARCHIVE_PREVIEW_PAGE_SIZE, 1, DEFAULT_ARCHIVE_PREVIEW_PAGE_SIZE);
  return Math.min(configured, Math.max(1, target.query.limit));
}

export function createArchivePreviewPages(
  target: Extract<PreviewTarget, { kind: 'archive' }>,
  client: LibraryQueryClient,
  options: ArchivePreviewPagesOptions = {},
): ArchivePreviewPages {
  const pageSize = normalizeQueryLimit(target, options.pageSize);
  const maxCachedPages = boundedInteger(options.maxCachedPages, DEFAULT_ARCHIVE_PREVIEW_MAX_CACHED_PAGES, 1, 8);
  const originQuery = {
    ...target.query,
    collectionPaths: target.query.collectionPaths === null ? null : [...target.query.collectionPaths],
    archivePath: target.archive.archivePath,
  };
  const cache = new Map<number, ArchivePreviewPage>();
  const pending = new Map<number, Promise<ArchivePreviewPage>>();
  let browseRevision: number | undefined;
  let generation = 0;
  let disposed = false;

  const ensureActive = () => {
    if (disposed) throw new Error('Archive preview request was disposed');
  };

  const rebase = (revision: number) => {
    generation++;
    browseRevision = revision;
    cache.clear();
  };

  const touch = (offset: number, page: ArchivePreviewPage) => {
    cache.delete(offset);
    cache.set(offset, page);
    while (cache.size > maxCachedPages) {
      const oldest = cache.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const fetchPage = async (offset: number): Promise<ArchivePreviewPage> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      ensureActive();
      const requestGeneration = generation;
      const expectedBrowseRevision = browseRevision ?? originQuery.expectedBrowseRevision;
      const query = {
        ...originQuery,
        limit: pageSize,
        offset,
        expectedBrowseRevision,
      };
      const result: LibraryPageResult = await client.getLibraryPage(query);
      ensureActive();
      if (requestGeneration !== generation) continue;
      if (result.status === 'stale') {
        rebase(result.revision);
        continue;
      }
      if (browseRevision !== undefined && result.revision !== browseRevision) {
        if (result.revision > browseRevision) rebase(result.revision);
        continue;
      }
      if (expectedBrowseRevision !== undefined && result.revision !== expectedBrowseRevision) {
        if (result.revision > expectedBrowseRevision) rebase(result.revision);
        continue;
      }
      browseRevision = result.revision;
      const files: FileRecord[] = [];
      for (const item of result.items) {
        if (item.kind !== 'file') throw new Error('Archive preview query returned archive summaries instead of file records');
        files.push(item.file);
      }
      const page: ArchivePreviewPage = {
        offset,
        files,
        totalModels: result.totalModels,
        nextOffset: result.nextOffset,
        revision: result.revision,
      };
      touch(offset, page);
      return page;
    }
    throw new Error('The library changed repeatedly while loading archive preview pages. Retry the page.');
  };

  return {
    pageSize,
    get cachedPageCount() { return cache.size; },
    updateThumbnail(fileId: number, contentRevision: number, thumbnailPath: string) {
      if (disposed) return;
      for (const [offset, page] of cache) {
        let changed = false;
        const files = page.files.map((file) => {
          if (file.id !== fileId || file.content_revision !== contentRevision) return file;
          changed = true;
          return { ...file, thumbnail: thumbnailPath, thumbnail_failed: 0 };
        });
        if (changed) cache.set(offset, { ...page, files });
      }
    },
    loadPage(offset: number) {
      if (!Number.isSafeInteger(offset) || offset < 0) return Promise.reject(new Error('Invalid archive page offset'));
      if (disposed) return Promise.reject(new Error('Archive preview request was disposed'));
      const pageOffset = Math.floor(offset / pageSize) * pageSize;
      const cached = cache.get(pageOffset);
      if (cached) {
        touch(pageOffset, cached);
        return Promise.resolve(cached);
      }
      const activeRequest = pending.get(pageOffset);
      if (activeRequest) return activeRequest;
      const request = fetchPage(pageOffset).finally(() => {
        if (pending.get(pageOffset) === request) pending.delete(pageOffset);
      });
      pending.set(pageOffset, request);
      return request;
    },
    invalidate(nextRevision: number) {
      if (disposed || !Number.isSafeInteger(nextRevision) || nextRevision < 0) return;
      const currentRevision = browseRevision ?? originQuery.expectedBrowseRevision;
      if (currentRevision !== undefined && nextRevision <= currentRevision) return;
      rebase(nextRevision);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      cache.clear();
      pending.clear();
    },
  };
}
