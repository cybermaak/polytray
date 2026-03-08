import type {
  FileRecord,
  SortOptions,
  LibraryStats,
  ScanProgressData,
  ScanCompleteData,
  FilesUpdatedData,
  FileIndexedData,
  ThumbnailReadyData,
  ThumbnailProgressData,
  ThumbnailRequestData,
  ThumbnailResultData,
} from "../shared/types";

export type { FileRecord };

interface PolytrayAPI {
  selectFolder: () => Promise<string | null>;
  getLastFolder: () => Promise<string | null>;
  getLibraryFolders: () => Promise<string[]>;
  getDirectories: () => Promise<string[]>;
  removeLibraryFolder: (path: string) => Promise<string[]>;

  scanFolder: (folderPath: string) => Promise<void>;
  rescan: () => Promise<void>;
  clearThumbnails: () => Promise<void>;
  refreshFolderThumbnails: (folderPath: string) => Promise<void>;

  getFiles: (
    opts: SortOptions,
  ) => Promise<{ files: FileRecord[]; total: number }>;
  getFileById: (id: number) => Promise<FileRecord>;
  getStats: () => Promise<LibraryStats>;

  readFileBuffer: (filePath: string) => Promise<ArrayBuffer>;
  readThumbnail: (thumbnailPath: string) => Promise<string | null>;
  requestThumbnailGeneration: (
    filePath: string,
    ext: string,
  ) => Promise<string | null>;
  startDrag: (filePath: string) => void;
  showContextMenu: (filePath: string) => void;
  showFolderContextMenu: (path: string) => void;

  startWatching: (folderPath: string) => Promise<void>;
  stopWatching: () => Promise<void>;

  onFolderAction: (
    callback: (action: "refresh" | "rescan", folderPath: string) => void,
  ) => () => void;
  onScanProgress: (callback: (data: ScanProgressData) => void) => () => void;
  onScanComplete: (callback: (data: ScanCompleteData) => void) => () => void;
  onFilesUpdated: (callback: (data: FilesUpdatedData) => void) => () => void;
  onFileIndexed: (callback: (data: FileIndexedData) => void) => () => void;
  onThumbnailReady: (
    callback: (data: ThumbnailReadyData) => void,
  ) => () => void;
  onThumbnailProgress: (
    callback: (data: ThumbnailProgressData) => void,
  ) => () => void;

  onThumbnailRequest: (
    callback: (data: ThumbnailRequestData) => void,
  ) => () => void;
  sendThumbnailResult: (result: ThumbnailResultData) => void;
}

declare global {
  interface Window {
    polytray: PolytrayAPI;
  }
}

export {};
