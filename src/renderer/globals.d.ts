interface FileRecord {
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
  indexed_at: number;
}

interface SortOptions {
  sort?: string;
  order?: "ASC" | "DESC";
  extension?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}

interface ScanProgress {
  current: number;
  total: number;
  filename: string;
  skipped: boolean;
}

interface ThumbnailResult {
  fileId: number;
  thumbnailPath: string;
}

interface PolytrayAPI {
  selectFolder: () => Promise<string | null>;
  getLastFolder: () => Promise<string | null>;
  getLibraryFolders: () => Promise<string[]>;
  removeLibraryFolder: (path: string) => Promise<string[]>;

  scanFolder: (folderPath: string) => Promise<void>;
  rescan: () => Promise<void>;
  clearThumbnails: () => Promise<void>;

  getFiles: (
    opts: SortOptions,
  ) => Promise<{ files: FileRecord[]; total: number }>;
  getFileById: (id: number) => Promise<FileRecord>;
  getStats: () => Promise<{
    total: number;
    stl: number;
    obj: number;
    threemf: number;
    totalSize: number;
  }>;

  readFileBuffer: (filePath: string) => Promise<ArrayBuffer>;
  readThumbnail: (thumbnailPath: string) => Promise<string | null>;
  requestThumbnailGeneration: (
    filePath: string,
    ext: string,
  ) => Promise<string | null>;
  startDrag: (filePath: string) => void;
  showContextMenu: (filePath: string) => void;

  startWatching: (folderPath: string) => Promise<void>;
  stopWatching: () => Promise<void>;

  onScanProgress: (callback: (data: ScanProgress) => void) => () => void;
  onScanComplete: (
    callback: (data: { totalFiles: number }) => void,
  ) => () => void;
  onFilesUpdated: (
    callback: (data: { directory: string }) => void,
  ) => () => void;
  onFileIndexed: (
    callback: (data: { path: string; current: number; total: number }) => void,
  ) => () => void;
  onThumbnailReady: (callback: (data: ThumbnailResult) => void) => () => void;
  onThumbnailProgress: (
    callback: (data: { current: number; total: number }) => void,
  ) => () => void;

  onThumbnailRequest: (
    callback: (data: {
      filePath: string;
      ext: string;
      thumbPath: string;
    }) => void,
  ) => () => void;
  sendThumbnailResult: (result: {
    filePath: string;
    thumbPath: string;
    success: boolean;
    dataUrl?: string;
  }) => void;
}

declare global {
  interface Window {
    polytray: PolytrayAPI;
  }
}

export {};
