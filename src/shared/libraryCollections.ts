export const COLLECTIONS_STORAGE_KEY = "polytray-collections";

export interface CollectionRecord {
  id: string;
  name: string;
  filePaths: string[];
}

export interface CollectionsState {
  collections: CollectionRecord[];
  activeCollectionId: string | null;
}

export const DEFAULT_COLLECTIONS_STATE: CollectionsState = {
  collections: [],
  activeCollectionId: null,
};

function normalizeCollection(collection: Partial<CollectionRecord>): CollectionRecord | null {
  if (
    typeof collection.id !== "string" ||
    !collection.id.trim() ||
    typeof collection.name !== "string" ||
    !collection.name.trim()
  ) {
    return null;
  }

  const filePaths = Array.isArray(collection.filePaths)
    ? Array.from(
        new Set(
          collection.filePaths
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      )
    : [];

  return {
    id: collection.id.trim(),
    name: collection.name.trim(),
    filePaths,
  };
}

export function normalizeCollectionsState(input: unknown): CollectionsState {
  const raw =
    input && typeof input === "object"
      ? (input as Partial<CollectionsState>)
      : {};

  const collections = Array.isArray(raw.collections)
    ? raw.collections
        .map((collection) => normalizeCollection(collection ?? {}))
        .filter((collection): collection is CollectionRecord => collection !== null)
    : [];

  const activeCollectionId =
    typeof raw.activeCollectionId === "string" &&
    collections.some((collection) => collection.id === raw.activeCollectionId)
      ? raw.activeCollectionId
      : null;

  return {
    collections,
    activeCollectionId,
  };
}

export function serializeCollectionsState(input: unknown): string {
  return JSON.stringify(normalizeCollectionsState(input));
}

export function upsertCollection(
  state: CollectionsState,
  collection: CollectionRecord,
): CollectionsState {
  const normalized = normalizeCollection(collection);
  if (!normalized) return state;

  const collections = [...state.collections];
  const existingIndex = collections.findIndex(
    (entry) => entry.id === normalized.id,
  );

  if (existingIndex >= 0) {
    collections[existingIndex] = normalized;
  } else {
    collections.push(normalized);
  }

  return normalizeCollectionsState({
    collections,
    activeCollectionId: state.activeCollectionId,
  });
}

export function removeCollection(
  state: CollectionsState,
  collectionId: string,
): CollectionsState {
  return normalizeCollectionsState({
    collections: state.collections.filter((entry) => entry.id !== collectionId),
    activeCollectionId:
      state.activeCollectionId === collectionId ? null : state.activeCollectionId,
  });
}

export function addFilesToCollection(
  state: CollectionsState,
  collectionId: string,
  filePaths: string[],
): CollectionsState {
  const collection = state.collections.find((entry) => entry.id === collectionId);
  if (!collection) return state;

  return upsertCollection(state, {
    ...collection,
    filePaths: [...collection.filePaths, ...filePaths],
  });
}
