export interface FileRecord {
  id: number;
  path: string;
  name: string;
  extension: string;
  directory: string;
  size_bytes: number;
  modified_at: number;
  vertex_count: number;
  face_count: number;
  thumbnail: string | null;
  thumbnail_failed: number;
  indexed_at: number;
}

export interface AppSettings {
  library_folders: string[];
  last_folder: string | null;
  lightMode: boolean;
  gridSize: "small" | "medium" | "large";
  autoRescan: boolean;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface CountRow {
  count: number;
}

export interface TotalRow {
  total: number;
}

export interface ScannedFile {
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime: number;
}

export const SUPPORTED_EXTENSIONS = ["stl", "obj", "3mf"];

export const EXT_SET = new Set(SUPPORTED_EXTENSIONS);

// Centralized IPC channel names — used across main, preload, and watcher
export const IPC = {
  // invoke channels (renderer → main, with response)
  SELECT_FOLDER: "select-folder",
  GET_LIBRARY_FOLDERS: "get-library-folders",
  REMOVE_LIBRARY_FOLDER: "remove-library-folder",
  GET_LAST_FOLDER: "get-last-folder",
  SCAN_FOLDER: "scan-folder",
  SCAN_ALL_LIBRARY: "scan-all-library",
  CLEAR_THUMBNAILS: "clear-thumbnails",
  GET_FILES: "get-files",
  GET_FILE_BY_ID: "get-file-by-id",
  READ_FILE_BUFFER: "read-file-buffer",
  READ_THUMBNAIL: "read-thumbnail",
  GET_THUMBNAIL_PATH: "get-thumbnail-path",
  GET_DIRECTORIES: "get-directories",
  REQUEST_THUMBNAIL_GENERATION: "request-thumbnail-generation",
  GET_STATS: "get-stats",
  START_WATCHING: "start-watching",
  STOP_WATCHING: "stop-watching",
  RESCAN: "rescan",
  REFRESH_FOLDER_THUMBNAILS: "refresh-folder-thumbnails",

  // send channels (renderer → main, fire-and-forget)
  ON_DRAG_START: "ondragstart",
  SHOW_CONTEXT_MENU: "show-context-menu",
  THUMBNAIL_GENERATED: "thumbnail-generated",

  // send channels (main → renderer)
  SCAN_PROGRESS: "scan-progress",
  SCAN_COMPLETE: "scan-complete",
  FILES_UPDATED: "files-updated",
  FILE_INDEXED: "file-indexed",
  THUMBNAIL_READY: "thumbnail-ready",
  THUMBNAIL_PROGRESS: "thumbnail-progress",
  GENERATE_THUMBNAIL_REQUEST: "generate-thumbnail-request",
} as const;

// ── IPC Payload Types (single source of truth) ──────────────────────

/** Options for the GET_FILES query */
export interface SortOptions {
  sort?: string;
  order?: "ASC" | "DESC";
  extension?: string | null;
  folder?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Return shape of GET_STATS */
export interface LibraryStats {
  total: number;
  stl: number;
  obj: number;
  threemf: number;
  totalSize: number;
}

/** SCAN_PROGRESS event payload */
export interface ScanProgressData {
  current: number;
  total: number;
  filename: string;
  skipped: boolean;
}

/** SCAN_COMPLETE event payload */
export interface ScanCompleteData {
  totalFiles: number;
}

/** FILES_UPDATED event payload */
export interface FilesUpdatedData {
  type: string;
  filePath: string;
}

/** FILE_INDEXED event payload */
export interface FileIndexedData {
  path: string;
  current: number;
  total: number;
}

/** THUMBNAIL_READY event payload */
export interface ThumbnailReadyData {
  fileId: number;
  thumbnailPath: string;
}

/** THUMBNAIL_PROGRESS event payload */
export interface ThumbnailProgressData {
  current: number;
  total: number;
  filename: string;
  phase: "start" | "progress" | "done";
}

/** GENERATE_THUMBNAIL_REQUEST event payload */
export interface ThumbnailRequestData {
  filePath: string;
  ext: string;
  thumbPath: string;
}

/** THUMBNAIL_GENERATED result sent back from renderer */
export interface ThumbnailResultData {
  filePath: string;
  thumbPath: string;
  success: boolean;
  dataUrl?: string;
}
