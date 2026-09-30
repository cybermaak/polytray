import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { FileRecord } from "../../shared/types";
import type { LibraryItem, LibraryPageResult, LibraryQuery } from "../../shared/libraryQuery";
import { preferCurrentFileRevision } from "../lib/fileRevision";

export interface LibraryPagesState {
  generation: number;
  queryKey: string | null;
  items: LibraryItem[];
  revision: number | null;
  staleRevision: number | null;
  totalItems: number;
  totalModels: number;
  nextOffset: number | null;
  retryOffset: number | null;
  ready: boolean;
  loading: boolean;
  loadingNext: boolean;
  refreshing: boolean;
  error: { offset: number; message: string } | null;
  refreshRequired: boolean;
}

export function createInitialLibraryPagesState(): LibraryPagesState {
  return {
    generation: 0,
    queryKey: null,
    items: [],
    revision: null,
    staleRevision: null,
    totalItems: 0,
    totalModels: 0,
    nextOffset: null,
    retryOffset: null,
    ready: false,
    loading: false,
    loadingNext: false,
    refreshing: false,
    error: null,
    refreshRequired: false,
  };
}

export function shouldRetryNextPage(state: LibraryPagesState) {
  return state.ready
    && state.retryOffset !== null
    && state.nextOffset === state.retryOffset
    && state.revision !== null
    && !state.loading
    && !state.loadingNext
    && !state.refreshing
    && !state.refreshRequired
    && state.error === null;
}

export function removeDeletedFileIds<T extends Pick<FileRecord, "id">>(records: T[], ids: number[]): T[] {
  if (ids.length === 0) return records;
  const removed = new Set(ids);
  return records.filter((record) => !removed.has(record.id));
}

export function getAffectedTrackedFiles(
  selectedFiles: FileRecord[],
  comparisonFiles: FileRecord[],
  affectedPaths: string[],
): FileRecord[] {
  const affected = new Set(affectedPaths);
  const recordsById = new Map<number, FileRecord>();
  for (const file of [...selectedFiles, ...comparisonFiles]) {
    if (affected.has(file.path)) recordsById.set(file.id, file);
  }
  return [...recordsById.values()];
}

export type LibraryPagesAction =
  | { type: "query-started"; generation: number; queryKey: string }
  | { type: "request-started"; generation: number; offset: number }
  | { type: "page-loaded"; generation: number; offset: number; page: LibraryPageResult }
  | { type: "page-failed"; generation: number; offset: number; error: string }
  | { type: "refresh-started"; generation: number }
  | {
      type: "refresh-completed";
      generation: number;
      items: LibraryItem[];
      revision: number;
      totalItems: number;
      totalModels: number;
      nextOffset: number | null;
    }
  | { type: "file-patched"; file: FileRecord }
  | { type: "files-patched"; files: FileRecord[] }
  | { type: "files-removed"; ids: number[] };

export function libraryPagesReducer(
  state: LibraryPagesState,
  action: LibraryPagesAction,
): LibraryPagesState {
  if (action.type === "query-started") {
    if (action.generation <= state.generation) return state;
    return {
      ...createInitialLibraryPagesState(),
      generation: action.generation,
      queryKey: action.queryKey,
      loading: true,
    };
  }

  if (action.type === "refresh-started") {
    if (action.generation < state.generation) return state;
    return {
      ...state,
      generation: action.generation,
      loading: false,
      loadingNext: false,
      refreshing: true,
      refreshRequired: true,
      error: null,
    };
  }

  if (action.type !== "file-patched" && action.type !== "files-patched" && action.type !== "files-removed"
    && action.generation !== state.generation) return state;

  switch (action.type) {
    case "request-started":
      return {
        ...state,
        loading: action.offset === 0 && state.items.length === 0,
        loadingNext: action.offset > 0,
        error: null,
      };
    case "page-loaded": {
      if (action.page.status === "stale") {
        return {
          ...state,
          loading: false,
          loadingNext: false,
          refreshing: false,
          refreshRequired: true,
          retryOffset: action.offset > 0 ? action.offset : null,
          staleRevision: action.page.revision,
        };
      }
      if (action.offset === 0) {
        return {
          ...state,
          items: dedupeItems(action.page.items),
          revision: action.page.revision,
          staleRevision: null,
          totalItems: action.page.totalItems,
          totalModels: action.page.totalModels,
          nextOffset: action.page.nextOffset,
          retryOffset: null,
          ready: true,
          loading: false,
          loadingNext: false,
          refreshing: false,
          error: null,
          refreshRequired: false,
        };
      }
      if (action.offset !== state.nextOffset) return state;
      if (state.revision === null || action.page.revision !== state.revision) {
        return {
          ...state,
          loadingNext: false,
          refreshRequired: true,
          staleRevision: action.page.revision,
          retryOffset: action.offset,
        };
      }
      return {
        ...state,
        items: dedupeItems([...state.items, ...action.page.items]),
        totalItems: action.page.totalItems,
        totalModels: action.page.totalModels,
        nextOffset: action.page.nextOffset,
        retryOffset: null,
        loading: false,
        loadingNext: false,
        error: null,
      };
    }
    case "page-failed":
      return {
        ...state,
        loading: false,
        loadingNext: false,
        refreshing: false,
        refreshRequired: false,
        retryOffset: null,
        error: { offset: action.offset, message: action.error },
      };
    case "refresh-completed":
      return {
        ...state,
        items: dedupeItems(action.items),
        revision: action.revision,
        staleRevision: null,
        totalItems: action.totalItems,
        totalModels: action.totalModels,
        nextOffset: action.nextOffset,
        retryOffset: state.nextOffset === action.nextOffset ? state.retryOffset : null,
        ready: true,
        refreshing: false,
        refreshRequired: false,
        error: null,
      };
    case "file-patched":
      return {
        ...state,
        items: state.items.map((item) => patchItemFile(item, action.file)),
      };
    case "files-patched": {
      const filesById = new Map(action.files.map((file) => [file.id, file]));
      return {
        ...state,
        items: state.items.map((item) => patchItemFiles(item, filesById)),
      };
    }
    case "files-removed": {
      const removedIds = new Set(action.ids);
      const items: LibraryItem[] = [];
      for (const item of state.items) {
        if (item.kind === "file") {
          if (!removedIds.has(item.file.id)) items.push(item);
          continue;
        }
        const thumbnailSamples = item.thumbnailSamples.filter((sample) => !removedIds.has(sample.id));
        items.push(thumbnailSamples.length === item.thumbnailSamples.length
          ? item
          : { ...item, thumbnailSamples });
      }
      return { ...state, items };
    }
  }
}

function dedupeItems(items: LibraryItem[]): LibraryItem[] {
  const byKey = new Map<string, LibraryItem>();
  for (const item of items) byKey.set(item.key, item);
  return [...byKey.values()];
}

function patchItemFile(item: LibraryItem, file: FileRecord): LibraryItem {
  if (item.kind === "file") {
    const latest = preferCurrentFileRevision(item.file, file);
    return latest === item.file ? item : { ...item, file: latest };
  }
  let changed = false;
  const thumbnailSamples = item.thumbnailSamples.map((sample) => {
    const latest = preferCurrentFileRevision(sample, file);
    if (latest === sample) return sample;
    changed = true;
    return latest;
  });
  if (!changed) return item;
  return {
    ...item,
    thumbnailSamples,
  };
}

function patchItemFiles(item: LibraryItem, filesById: ReadonlyMap<number, FileRecord>): LibraryItem {
  if (item.kind === "file") {
    const file = filesById.get(item.file.id);
    return file ? patchItemFile(item, file) : item;
  }
  return item.thumbnailSamples.reduce<LibraryItem>((patched, sample) => {
    const file = filesById.get(sample.id);
    return file ? patchItemFile(patched, file) : patched;
  }, item);
}

function getQueryKey(query: LibraryQuery) {
  return JSON.stringify({
    ...query,
    offset: 0,
    expectedBrowseRevision: undefined,
    collectionPaths: query.collectionPaths === null
      ? null
      : [...query.collectionPaths].sort(),
  });
}

export function getLibraryQueryKey(query: LibraryQuery) {
  return getQueryKey(query);
}

export function libraryQueryScopeKey(query: LibraryQuery) {
  const { limit: _limit, offset: _offset, expectedBrowseRevision: _revision, ...scope } = query;
  return JSON.stringify({
    ...scope,
    collectionPaths: query.collectionPaths === null
      ? null
      : [...query.collectionPaths].sort(),
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The library page could not be loaded.";
}

export type ConsistentPageRangeResult =
  | { status: "loaded"; items: LibraryItem[]; revision: number; totalItems: number; totalModels: number; nextOffset: number | null }
  | { status: "cancelled" }
  | { status: "error"; error: unknown }
  | { status: "revision-changed" };

/** Reads one revision-consistent prefix, stopping promptly if its scope is obsolete. */
export async function fetchConsistentPageRange(
  readPage: (query: LibraryQuery) => Promise<LibraryPageResult>,
  baseQuery: LibraryQuery,
  targetCount: number,
  isCurrent: () => boolean,
  maxRestarts = 1,
): Promise<ConsistentPageRangeResult> {
  const querySnapshot: LibraryQuery = {
    ...baseQuery,
    collectionPaths: baseQuery.collectionPaths === null ? null : [...baseQuery.collectionPaths],
    offset: 0,
    expectedBrowseRevision: undefined,
  };

  for (let attempt = 0; attempt <= maxRestarts; attempt += 1) {
    if (!isCurrent()) return { status: "cancelled" };
    const items: LibraryItem[] = [];
    let firstPage: Extract<LibraryPageResult, { status: "ok" }> | null = null;
    let offset = 0;
    let restart = false;

    while (true) {
      if (!isCurrent()) return { status: "cancelled" };
      let response: LibraryPageResult;
      try {
        response = await readPage({
          ...querySnapshot,
          offset,
          ...(firstPage ? { expectedBrowseRevision: firstPage.revision } : {}),
        });
      } catch (error) {
        return isCurrent() ? { status: "error", error } : { status: "cancelled" };
      }
      if (!isCurrent()) return { status: "cancelled" };
      if (response.status === "stale" || (firstPage && response.revision !== firstPage.revision)) {
        restart = true;
        break;
      }
      firstPage ??= response;
      items.push(...response.items);
      if (response.nextOffset === null || items.length >= targetCount) {
        return {
          status: "loaded",
          items,
          revision: firstPage.revision,
          totalItems: response.totalItems,
          totalModels: response.totalModels,
          nextOffset: response.nextOffset,
        };
      }
      offset = response.nextOffset;
    }

    if (!restart) break;
  }
  return isCurrent() ? { status: "revision-changed" } : { status: "cancelled" };
}

interface PendingNextPage {
  generation: number;
  offset: number;
  promise: Promise<void>;
}

interface PendingRefresh {
  generation: number;
  promise: Promise<void>;
}

export interface UseLibraryPagesResult extends LibraryPagesState {
  queryKey: string;
  refresh: () => Promise<void>;
  loadNext: () => Promise<void>;
  retry: () => Promise<void>;
  patchFile: (file: FileRecord) => void;
  patchFiles: (files: FileRecord[]) => void;
  removeFiles: (ids: number[]) => void;
}

/** Owns query generations, revision-consistent pages, and refresh/retry behavior. */
export function useLibraryPages(query: LibraryQuery, enabled = true): UseLibraryPagesResult {
  const [state, dispatch] = useReducer(libraryPagesReducer, undefined, createInitialLibraryPagesState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const queryRef = useRef(query);
  queryRef.current = query;
  const queryKey = useMemo(() => getQueryKey(query), [query]);
  const generationRef = useRef(0);
  const scopeEpochRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const pendingNextRef = useRef<PendingNextPage | null>(null);
  const completedNextRef = useRef<{ generation: number; offset: number } | null>(null);
  const pendingRefreshRef = useRef<PendingRefresh | null>(null);

  const fetchPage = useCallback(async (
    generation: number,
    offset: number,
    expectedBrowseRevision?: number,
    requestQuery: LibraryQuery = queryRef.current,
    scopeEpoch = scopeEpochRef.current,
  ): Promise<LibraryPageResult | null> => {
    const requestQueryKey = getQueryKey(requestQuery);
    const isCurrentRequest = () => enabledRef.current
      && generationRef.current === generation
      && scopeEpochRef.current === scopeEpoch
      && getQueryKey(queryRef.current) === requestQueryKey;
    if (!isCurrentRequest()) return null;
    dispatch({ type: "request-started", generation, offset });
    try {
      const page = await window.polytray.getLibraryPage({
        ...requestQuery,
        offset,
        ...(expectedBrowseRevision === undefined ? {} : { expectedBrowseRevision }),
      });
      if (!isCurrentRequest()) return null;
      dispatch({ type: "page-loaded", generation, offset, page });
      return page;
    } catch (error) {
      if (isCurrentRequest()) dispatch({ type: "page-failed", generation, offset, error: errorMessage(error) });
      return null;
    }
  }, []);

  useEffect(() => {
    const scopeEpoch = ++scopeEpochRef.current;
    if (enabled) {
      const generation = ++generationRef.current;
      pendingNextRef.current = null;
      completedNextRef.current = null;
      pendingRefreshRef.current = null;
      dispatch({ type: "query-started", generation, queryKey });
      const requestQuery = { ...queryRef.current, collectionPaths: queryRef.current.collectionPaths === null
        ? null
        : [...queryRef.current.collectionPaths] };
      void fetchPage(generation, 0, undefined, requestQuery, scopeEpoch);
    }
    return () => {
      if (scopeEpochRef.current === scopeEpoch) scopeEpochRef.current += 1;
      generationRef.current += 1;
      pendingNextRef.current = null;
      completedNextRef.current = null;
      pendingRefreshRef.current = null;
    };
  }, [enabled, fetchPage, queryKey]);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    const existing = pendingRefreshRef.current;
    if (existing?.generation === generationRef.current) return existing.promise;

    const snapshot = stateRef.current;
    const generation = ++generationRef.current;
    const scopeEpoch = scopeEpochRef.current;
    const querySnapshot: LibraryQuery = {
      ...queryRef.current,
      collectionPaths: queryRef.current.collectionPaths === null
        ? null
        : [...queryRef.current.collectionPaths],
    };
    const requestQueryKey = getQueryKey(querySnapshot);
    const targetCount = Math.max(snapshot.items.length, querySnapshot.limit);
    pendingNextRef.current = null;
    completedNextRef.current = null;
    dispatch({ type: "refresh-started", generation });

    const isCurrentRequest = () => enabledRef.current
      && generationRef.current === generation
      && scopeEpochRef.current === scopeEpoch
      && getQueryKey(queryRef.current) === requestQueryKey;
    const promise = (async () => {
      const result = await fetchConsistentPageRange(
        (request) => window.polytray.getLibraryPage(request),
        querySnapshot,
        targetCount,
        isCurrentRequest,
      );
      if (result.status === "cancelled" || !isCurrentRequest()) return;
      if (result.status === "loaded") {
        dispatch({
          type: "refresh-completed",
          generation,
          items: result.items,
          revision: result.revision,
          totalItems: result.totalItems,
          totalModels: result.totalModels,
          nextOffset: result.nextOffset,
        });
        return;
      }
      if (result.status === "error") {
        dispatch({
          type: "page-failed",
          generation,
          offset: 0,
          error: errorMessage(result.error),
        });
        return;
      }
      dispatch({
        type: "page-failed",
        generation,
        offset: 0,
        error: "The library changed again while refreshing. Retry to load the latest results.",
      });
    })().finally(() => {
      if (pendingRefreshRef.current?.generation === generation) pendingRefreshRef.current = null;
    });

    pendingRefreshRef.current = { generation, promise };
    return promise;
  }, [enabled]);

  useEffect(() => {
    if (enabled && state.refreshRequired && !state.refreshing) void refresh();
  }, [enabled, refresh, state.refreshRequired, state.refreshing]);

  const loadNext = useCallback((): Promise<void> => {
      const current = stateRef.current;
    if (!enabled || current.generation !== generationRef.current
      || current.queryKey !== getQueryKey(queryRef.current)
      || current.refreshing || current.nextOffset === null || current.revision === null) {
      return Promise.resolve();
    }
    const existing = pendingNextRef.current;
    if (existing?.generation === current.generation && existing.offset === current.nextOffset) {
      return existing.promise;
    }
    const generation = current.generation;
    const offset = current.nextOffset;
    if (completedNextRef.current?.generation === generation && completedNextRef.current.offset === offset) {
      return Promise.resolve();
    }
    const querySnapshot = { ...queryRef.current, collectionPaths: queryRef.current.collectionPaths === null
      ? null
      : [...queryRef.current.collectionPaths] };
    const scopeEpoch = scopeEpochRef.current;
    const promise = fetchPage(generation, offset, current.revision, querySnapshot, scopeEpoch).then((page) => {
      if (page && enabledRef.current && generationRef.current === generation
        && scopeEpochRef.current === scopeEpoch) {
        completedNextRef.current = { generation, offset };
      }
    }).finally(() => {
      if (pendingNextRef.current?.generation === generation && pendingNextRef.current.offset === offset) {
        pendingNextRef.current = null;
      }
    });
    pendingNextRef.current = { generation, offset, promise };
    return promise;
  }, [enabled, fetchPage]);

  useEffect(() => {
    if (shouldRetryNextPage(state)) void loadNext();
  }, [loadNext, state]);

  const retry = useCallback((): Promise<void> => {
    const failedOffset = stateRef.current.error?.offset;
    return failedOffset !== undefined && failedOffset > 0 ? loadNext() : refresh();
  }, [loadNext, refresh]);

  const patchFile = useCallback((file: FileRecord) => {
    dispatch({ type: "file-patched", file });
  }, []);

  const patchFiles = useCallback((files: FileRecord[]) => {
    if (files.length > 0) dispatch({ type: "files-patched", files });
  }, []);

  const removeFiles = useCallback((ids: number[]) => {
    if (ids.length > 0) dispatch({ type: "files-removed", ids });
  }, []);

  return { ...state, queryKey, refresh, loadNext, retry, patchFile, patchFiles, removeFiles };
}
