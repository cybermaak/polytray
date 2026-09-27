import type { FileRecord } from "./types";

export type LibrarySortField = "name" | "size" | "date" | "vertices" | "faces";
export type SortDirection = "ASC" | "DESC";

export interface LibraryQuery {
  sort: LibrarySortField;
  direction: SortDirection;
  extension: string | null;
  folder: string | null;
  search: string;
  /** null means unrestricted; [] deliberately matches no paths. */
  collectionPaths: string[] | null;
  limit: number;
  offset: number;
  expectedBrowseRevision?: number;
  archivePath?: string | null;
}

export interface LibraryFileItem {
  kind: "file";
  key: `file:${number}`;
  file: FileRecord;
}

export interface LibraryArchiveItem {
  kind: "archive";
  key: `archive:${string}`;
  archivePath: string;
  name: string;
  modelCount: number;
  vertexCount: number;
  faceCount: number;
  sizeBytes: number;
  thumbnailSamples: FileRecord[];
}

export type LibraryItem = LibraryFileItem | LibraryArchiveItem;

export type LibraryPageResult =
  | { status: "ok"; revision: number; items: LibraryItem[]; totalItems: number; totalModels: number; nextOffset: number | null }
  | { status: "stale"; revision: number };

export interface LibraryQueryClient {
  getLibraryPage(query: LibraryQuery): Promise<LibraryPageResult>;
}

export interface IndexRepository {
  applyIndexBatch(input: IndexBatch): IndexBatchResult;
  applyWatchUpdate(input: WatchUpdate): IndexMutationResult;
  deleteContainedFiles(rootPath: string, candidates: PruneCandidate[]): IndexMutationResult;
  applyMetadataResult(input: MetadataEnrichmentUpdate): MetadataEnrichmentResult;
  updateFileMetadata(input: RevisionGuardedMetadataUpdate): RevisionGuardedMetadataResult;
  getBrowseRevision(): number;
  getFileContentRevision(fileId: number): number | null;
}

export interface IndexBatch {
  scanGeneration: number;
  records: IndexInput[];
}

export interface IndexBatchResult {
  inserted: number;
  updated: number;
  unchanged: number;
  browseRevision: number;
  committed: Array<{ id: number; path: string; contentRevision: number }>;
}

export interface IndexInput {
  path: string;
  name: string;
  extension: string;
  directory: string;
  sizeBytes: number;
  modifiedAt: number;
  archivePath?: string | null;
  scanGeneration: number;
  expectedContentRevision?: number;
}

export type WatchUpdate =
  | {
    kind: "add" | "change";
    path: string;
    name: string;
    extension: string;
    directory: string;
    sizeBytes: number;
    modifiedAt: number;
    archivePath: string | null;
    expectedContentRevision?: number;
    watcherRevision?: number;
  }
  | {
    kind: "remove";
    path: string;
    expectedContentRevision: number;
    watcherRevision?: number;
  };

export interface RevisionGuardedMetadataUpdate {
  fileId: number;
  expectedContentRevision: number;
  tags?: string[] | null;
  notes?: string | null;
}

export interface MetadataEnrichmentUpdate {
  fileId: number;
  path: string;
  expectedContentRevision: number;
  vertexCount: number;
  faceCount: number;
  dimensions: string | null;
}

export type MetadataEnrichmentResult =
  | { status: "updated"; contentRevision: number }
  | { status: "stale"; currentContentRevision: number | null }
  | { status: "missing" };

export interface PruneCandidate {
  path: string;
  scanGeneration: number;
  expectedContentRevision: number;
}

export type RevisionGuardedMetadataResult =
  | { status: "updated"; file: FileRecord; browseRevision: number }
  | { status: "stale"; currentContentRevision: number | null }
  | { status: "missing" };

export interface IndexMutationResult {
  affectedPaths: string[];
  rowsChanged: boolean;
  annotationsChanged: boolean;
  statsChanged: boolean;
  topologyChanged: boolean;
  thumbnailOnly: boolean;
  browseRevision: number;
}
