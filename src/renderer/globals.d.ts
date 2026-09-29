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
  WatcherErrorData,
  UpdateFileMetadataData,
  IndexMutationResult,
  LibraryQuery,
  LibraryPageResult,
  SlicerHandoffRequest,
  SlicerHandoffResult,
  SlicerConfiguration,
  BackgroundJob,
  BackgroundJobCommandResult,
} from "../shared/types";
import type { PreparedPreview, PreviewParseRequest } from "../shared/previewContracts";
import type {
  MetadataBackupSnapshot,
  MetadataImportCommitResult,
  MetadataImportPlan,
  MetadataImportRecoveryResult,
  MetadataRestoreStatus,
  StagedMetadataRestore,
} from "../shared/backupContracts";

type RendererRestoreSnapshot = MetadataBackupSnapshot & { preferences: Record<string, unknown> };
type MetadataRestorePreviewResult =
  | { status: "preview"; plan: MetadataImportPlan }
  | { status: "failed"; message: string };

export type { FileRecord };

interface PolytrayAPI {
  selectFolder: () => Promise<string | null>;
  getLastFolder: () => Promise<string | null>;
  getLibraryFolders: () => Promise<string[]>;
  getDirectories: () => Promise<string[]>;
  removeLibraryFolder: (path: string) => Promise<boolean>;

  scanFolder: (folderPath: string, settings: RuntimeSettingsData) => Promise<ScanCompleteData>;
  rescan: () => Promise<void>;
  clearThumbnails: (settings: RuntimeSettingsData) => Promise<void>;
  refreshFolderThumbnails: (folderPath: string, settings: RuntimeSettingsData) => Promise<void>;
  getBackgroundJobs: () => Promise<BackgroundJob[]>;
  pauseBackgroundJob: (jobId: string) => Promise<BackgroundJobCommandResult>;
  resumeBackgroundJob: (jobId: string) => Promise<BackgroundJobCommandResult>;
  cancelBackgroundJob: (jobId: string) => Promise<BackgroundJobCommandResult>;
  retryBackgroundJobFailures: (jobId: string) => Promise<BackgroundJobCommandResult>;
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
  updateWatcherSettings: (settings: RuntimeSettingsData) => Promise<boolean>;
  onWatcherError: (callback: (error: WatcherErrorData) => void) => () => void;
  getMetadataRestoreSnapshot: (snapshot: RendererRestoreSnapshot) => Promise<RendererRestoreSnapshot>;
  publishMetadataRestoreSnapshot: (snapshot: RendererRestoreSnapshot) => Promise<void>;
  completeMetadataRestoreStartup: (snapshot: RendererRestoreSnapshot) => Promise<MetadataImportRecoveryResult>;
  previewMetadataRestore: (request: { backup: unknown; currentSnapshot: RendererRestoreSnapshot; options?: { replaceSettings?: boolean; replaceRoots?: boolean } }) => Promise<MetadataRestorePreviewResult>;
  commitMetadataRestore: (transactionId: string) => Promise<MetadataImportCommitResult>;
  acknowledgeMetadataRestore: (transactionId: string, rendererRevision: number) => Promise<void>;
  cancelMetadataRestore: (transactionId: string) => Promise<void>;
  getMetadataRestoreStatus: () => Promise<MetadataRestoreStatus>;
  retryPendingMetadataAnnotations: () => Promise<{ appliedCount: number; conflictCount: number }>;
  applyMetadataRestoreState: (state: StagedMetadataRestore) => Promise<void>;
  onMetadataRestoreApply: (callback: (request: { requestId: string; state: StagedMetadataRestore }) => void) => () => void;
  acknowledgeMetadataRestoreApply: (requestId: string, snapshot: RendererRestoreSnapshot) => Promise<void>;
  onMetadataRestoreMutationLock: (callback: (request: { requestId: string; locked: boolean }) => void) => () => void;
  acknowledgeMetadataRestoreMutationLock: (requestId: string) => Promise<void>;
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
