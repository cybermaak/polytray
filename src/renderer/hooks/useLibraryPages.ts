import type { FileRecord } from "../../shared/types";
import type { LibraryItem, LibraryPageResult } from "../../shared/libraryQuery";

export interface LibraryPagesState {
  generation: number;
  queryKey: string | null;
  items: LibraryItem[];
  revision: number | null;
  staleRevision: number | null;
  totalItems: number;
  totalModels: number;
  nextOffset: number | null;
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
    loading: false,
    loadingNext: false,
    refreshing: false,
    error: null,
    refreshRequired: false,
  };
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

  if (action.generation !== state.generation) return state;

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
        };
      }
      return {
        ...state,
        items: dedupeItems([...state.items, ...action.page.items]),
        totalItems: action.page.totalItems,
        totalModels: action.page.totalModels,
        nextOffset: action.page.nextOffset,
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
        error: { offset: action.offset, message: action.error },
      };
    case "refresh-started":
      return {
        ...state,
        generation: action.generation,
        loading: false,
        loadingNext: false,
        refreshing: true,
        refreshRequired: true,
        error: null,
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
        refreshing: false,
        refreshRequired: false,
        error: null,
      };
    case "file-patched":
      return {
        ...state,
        items: state.items.map((item) => patchItemFile(item, action.file)),
      };
    case "files-removed": {
      const removedIds = new Set(action.ids);
      const items = state.items.filter((item) => item.kind === "archive"
        || !removedIds.has(item.file.id));
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
    return item.file.id === file.id ? { ...item, file } : item;
  }
  return {
    ...item,
    thumbnailSamples: item.thumbnailSamples.map((sample) => sample.id === file.id ? file : sample),
  };
}
