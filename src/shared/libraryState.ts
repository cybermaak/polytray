export const LIBRARY_STATE_STORAGE_KEY = "polytray-library-state";

export interface LibraryState {
  libraryFolders: string[];
  lastFolder: string | null;
}

export const DEFAULT_LIBRARY_STATE: LibraryState = {
  libraryFolders: [],
  lastFolder: null,
};

function normalizeFolderList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const folders: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    folders.push(trimmed);
  }

  return folders;
}

export function normalizeLibraryState(input: unknown): LibraryState {
  const raw =
    input && typeof input === "object"
      ? (input as Partial<Record<keyof LibraryState, unknown>>)
      : {};

  const libraryFolders = normalizeFolderList(raw.libraryFolders);
  const lastFolder =
    typeof raw.lastFolder === "string" && libraryFolders.includes(raw.lastFolder)
      ? raw.lastFolder
      : libraryFolders[0] ?? null;

  return {
    libraryFolders,
    lastFolder,
  };
}

export function serializeLibraryState(input: unknown) {
  return JSON.stringify(normalizeLibraryState(input));
}

export function withAddedLibraryFolder(
  state: LibraryState,
  folderPath: string,
): LibraryState {
  if (state.libraryFolders.includes(folderPath)) {
    return {
      libraryFolders: state.libraryFolders,
      lastFolder: folderPath,
    };
  }

  return {
    libraryFolders: [...state.libraryFolders, folderPath],
    lastFolder: folderPath,
  };
}

export function withRemovedLibraryFolder(
  state: LibraryState,
  folderPath: string,
): LibraryState {
  const libraryFolders = state.libraryFolders.filter((path) => path !== folderPath);

  return {
    libraryFolders,
    lastFolder:
      state.lastFolder === folderPath
        ? libraryFolders[0] ?? null
        : state.lastFolder,
  };
}
