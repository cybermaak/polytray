import type {
  FileRecord,
  SortOptions,
  LibraryStats,
  ScanProgressData,
  ScanCompleteData,
  FilesUpdatedData,
  FileIndexedData,
  ThumbnailReadyData,
  ThumbnailInvalidatedData,
  ThumbnailProgressData,
  ThumbnailRequestData,
  ThumbnailResultData,
  PreviewParseCancelRequestData,
  PreviewParseDispatchData,
  PreviewMetricData,
  MainWindowVisibilityData,
  RuntimeSettingsData,
  UpdateFileMetadataData,
  IndexMutationResult,
  LibraryQuery,
  LibraryPageResult,
  SlicerHandoffRequest,
  SlicerHandoffResult,
  SlicerConfiguration,
  BackgroundJob,
} from "../shared/types";
import type { PreparedPreview, PreviewParseRequest } from "../shared/previewContracts";

export type { FileRecord };

interface PolytrayAPI {
  selectFolder: () => Promise<string | null>;
  getLastFolder: () => Promise<string | null>;
  getLibraryFolders: () => Promise<string[]>;
  getDirectories: () => Promise<string[]>;
  removeLibraryFolder: (path: string) => Promise<boolean>;

  scanFolder: (folderPath: string, settings: RuntimeSettingsData) => Promise<void>;
  rescan: () => Promise<void>;
  clearThumbnails: (settings: RuntimeSettingsData) => Promise<void>;
  refreshFolderThumbnails: (folderPath: string, settings: RuntimeSettingsData) => Promise<void>;
  getBackgroundJobs: () => Promise<BackgroundJob[]>;
  getThumbnailJobs: () => Promise<BackgroundJob[]>;
  pauseThumbnailJob: (jobId: string) => Promise<void>;
  resumeThumbnailJob: (jobId: string) => Promise<void>;
  cancelThumbnailJob: (jobId: string) => Promise<void>;
  retryThumbnailJobFailures: (jobId: string) => Promise<void>;

  getFiles: (
    opts: SortOptions,
  ) => Promise<{ files: FileRecord[]; total: number }>;
  getLibraryPage: (query: LibraryQuery) => Promise<LibraryPageResult>;
  getFileById: (id: number) => Promise<FileRecord>;
  updateFileMetadata: (payload: UpdateFileMetadataData) => Promise<FileRecord>;
  getStats: () => Promise<LibraryStats>;
  openInSlicer: (request: SlicerHandoffRequest) => Promise<SlicerHandoffResult>;
  cancelSlicerHandoff: (requestId: string) => Promise<boolean>;
  pickSlicerApplication: () => Promise<SlicerConfiguration | null>;

  readFileBuffer: (filePath: string) => Promise<ArrayBuffer>;
  readThumbnail: (thumbnailPath: string) => Promise<string | null>;
  requestThumbnailGeneration: (
    filePath: string,
    ext: string,
    settings?: RuntimeSettingsData,
  ) => Promise<string | null>;
  requestPreviewParse: (
    request: PreviewParseRequest,
  ) => Promise<PreparedPreview>;
  __previewParsePendingCounts?: () => {
    parses: number;
    archiveReads: number;
    hiddenPorts: number;
    hiddenParseListeners: number;
  };
  cancelPreviewParse: (
    requestId: string,
    reason: PreviewParseCancelRequestData["reason"],
  ) => void;
  readPreviewArchiveBuffer: (request: PreviewParseRequest) => Promise<ArrayBuffer>;
  markPreviewRuntimeReady: () => void;
  emitPreviewMetric: (metric: PreviewMetricData) => void;
  startDrag: (filePath: string) => void;
  showContextMenu: (filePath: string) => void;
  showFolderContextMenu: (path: string) => void;
  showArchiveContextMenu: (path: string, isSummary: boolean) => void;

  startWatching: (folderPaths: string[], settings: RuntimeSettingsData) => Promise<void>;
  stopWatching: () => Promise<void>;
  getMainWindowVisibility: () => Promise<MainWindowVisibilityData>;
  onMainWindowVisibility: (
    callback: (data: MainWindowVisibilityData) => void,
  ) => () => void;

  onFolderAction: (
    callback: (action: "refresh" | "rescan", folderPath: string) => void,
  ) => () => void;
  onArchiveOpen: (callback: (archiveVirtualPath: string) => void) => () => void;
  onScanProgress: (callback: (data: ScanProgressData) => void) => () => void;
  onScanComplete: (callback: (data: ScanCompleteData) => void) => () => void;
  onBackgroundJobChanged: (callback: (job: BackgroundJob) => void) => () => void;
  onFilesUpdated: (callback: (data: FilesUpdatedData) => void) => () => void;
  onLibraryChanged: (callback: (data: IndexMutationResult) => void) => () => void;
  onFileIndexed: (callback: (data: FileIndexedData) => void) => () => void;
  onThumbnailReady: (
    callback: (data: ThumbnailReadyData) => void,
  ) => () => void;
  onThumbnailInvalidated: (
    callback: (data: ThumbnailInvalidatedData) => void,
  ) => () => void;
  onThumbnailProgress: (
    callback: (data: ThumbnailProgressData) => void,
  ) => () => void;

  onThumbnailRequest: (
    callback: (data: ThumbnailRequestData) => void,
  ) => () => void;
  sendThumbnailResult: (result: ThumbnailResultData) => void;
  onPreviewParseRequest: (
    callback: (data: PreviewParseDispatchData) => void,
  ) => () => void;
}

declare global {
  interface Window {
    polytray: PolytrayAPI;
  }
}

declare module "*?worker" {
  const content: new () => Worker;
  export default content;
}

export {};
