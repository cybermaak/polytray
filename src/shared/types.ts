import type { PreviewParseCancelRequest, PreviewParseRequest } from "./previewContracts";
import type { ThumbnailCacheKey, ThumbnailIdentity, ThumbnailSize } from './thumbnailContracts';

export interface FileRecord {
  id: number;
  path: string;
  name: string;
  extension: string;
  directory: string;
  size_bytes: number;
  modified_at: number;
  content_revision: number;
  archive_path: string | null;
  vertex_count: number;
  face_count: number;
  tags?: string | null;
  notes?: string | null;
  dimensions?: string | null;
  thumbnail: string | null;
  thumbnail_failed: number;
  indexed_at: number;
}

export interface ModelDimensions {
  x: number;
  y: number;
  z: number;
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

export const SUPPORTED_EXTENSIONS = ["stl", "obj", "3mf"] as const;

export const EXT_SET = new Set<string>(SUPPORTED_EXTENSIONS);

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
  GET_LIBRARY_PAGE: "get-library-page",
  GET_FILE_BY_ID: "get-file-by-id",
  READ_FILE_BUFFER: "read-file-buffer",
  READ_THUMBNAIL: "read-thumbnail",
  GET_THUMBNAIL_PATH: "get-thumbnail-path",
  GET_DIRECTORIES: "get-directories",
  UPDATE_FILE_METADATA: "update-file-metadata",
  REQUEST_THUMBNAIL_GENERATION: "request-thumbnail-generation",
  GET_BACKGROUND_JOBS: "get-background-jobs",
  EXPORT_METADATA_BACKUP: "export-metadata-backup",
  PAUSE_BACKGROUND_JOB: "pause-background-job",
  RESUME_BACKGROUND_JOB: "resume-background-job",
  CANCEL_BACKGROUND_JOB: "cancel-background-job",
  RETRY_BACKGROUND_JOB_FAILURES: "retry-background-job-failures",
  GET_THUMBNAIL_JOBS: "get-thumbnail-jobs",
  PAUSE_THUMBNAIL_JOB: "pause-thumbnail-job",
  RESUME_THUMBNAIL_JOB: "resume-thumbnail-job",
  CANCEL_THUMBNAIL_JOB: "cancel-thumbnail-job",
  RETRY_THUMBNAIL_JOB_FAILURES: "retry-thumbnail-job-failures",
  REQUEST_PREVIEW_PARSE: "request-preview-parse",
  READ_PREVIEW_ARCHIVE_BUFFER: "read-preview-archive-buffer",
  CANCEL_PREVIEW_PARSE: "cancel-preview-parse",
  PREVIEW_RUNTIME_READY: "preview-runtime-ready",
  PREVIEW_PARSE_SETTLED: "preview-parse-settled",
  PREVIEW_PARSE_CONTROL: "preview-parse-control",
  GET_STATS: "get-stats",
  START_WATCHING: "start-watching",
  STOP_WATCHING: "stop-watching",
  UPDATE_WATCHER_SETTINGS: "update-watcher-settings",
  WATCHER_ERROR: "watcher-error",
  RESCAN: "rescan",
  REFRESH_FOLDER_THUMBNAILS: "refresh-folder-thumbnails",
  UPDATE_SETTING: "update-setting",
  OPEN_IN_SLICER: "open-in-slicer",
  CANCEL_SLICER_HANDOFF: "cancel-slicer-handoff",
  PICK_SLICER_APPLICATION: "pick-slicer-application",

  // send channels (renderer → main, fire-and-forget)
  ON_DRAG_START: "ondragstart",
  SHOW_CONTEXT_MENU: "show-context-menu",
  SHOW_FOLDER_CONTEXT_MENU: "show-folder-context-menu",
  SHOW_ARCHIVE_CONTEXT_MENU: "show-archive-context-menu",
  THUMBNAIL_GENERATED: "thumbnail-generated",
  PREVIEW_METRIC: "preview-metric",

  // send channels (main → renderer)
  SCAN_PROGRESS: "scan-progress",
  SCAN_COMPLETE: "scan-complete",
  FILES_UPDATED: "files-updated",
  FILE_INDEXED: "file-indexed",
  THUMBNAIL_READY: "thumbnail-ready",
  THUMBNAIL_INVALIDATED: "thumbnail-invalidated",
  THUMBNAIL_PROGRESS: "thumbnail-progress",
  BACKGROUND_JOB_CHANGED: "background-job-changed",
  GENERATE_THUMBNAIL_REQUEST: "generate-thumbnail-request",
  GENERATE_PREVIEW_PARSE_REQUEST: "generate-preview-parse-request",
  PREVIEW_PARSE_PORT: "preview-parse-port",
  GET_MAIN_WINDOW_VISIBILITY: "get-main-window-visibility",
  MAIN_WINDOW_VISIBILITY: "main-window-visibility",
  LIBRARY_CHANGED: "library-changed",
} as const;

export const METADATA_RESTORE_IPC = {
  snapshot: 'get-metadata-restore-snapshot',
  publishSnapshot: 'publish-metadata-restore-snapshot',
  bootstrap: 'complete-metadata-restore-startup',
  preview: 'preview-metadata-backup-import',
  commit: 'commit-metadata-backup-import',
  acknowledge: 'acknowledge-metadata-backup-import',
  cancel: 'cancel-metadata-backup-import',
  status: 'get-metadata-restore-status',
  retry: 'retry-pending-metadata-annotations',
  applyRequest: 'apply-metadata-restore-state',
  applyEvent: 'metadata-restore-apply-state',
  applyAck: 'metadata-restore-apply-ack',
  mutationLockEvent: 'metadata-restore-mutation-lock',
  mutationLockAck: 'metadata-restore-mutation-lock-ack',
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
  /** Null until discovery completes and the total is known. */
  total: number | null;
  filename: string;
  skipped: boolean;
  jobId?: string;
  discovered?: number;
  indexed?: number;
}

/** SCAN_COMPLETE event payload */
export interface ScanCompleteData {
  totalFiles: number;
  state?: "completed" | "partial" | "failed" | "cancelled";
  affectedScopes?: string[];
  retainedCount?: number;
  jobId?: string;
  discovered?: number;
  indexed?: number;
  metadataCompleted?: number;
  metadataFailed?: number;
}

/** FILES_UPDATED event payload */
export interface FilesUpdatedData {
  type: string;
  filePath: string;
  /** Main-process event time for root status transitions; comparable to BackgroundJob.startedAt. */
  timestamp?: number;
}

export interface WatcherErrorData {
  rootPaths: string[];
  message: string;
}

/** FILE_INDEXED event payload */
export interface FileIndexedData {
  path: string;
  current: number;
  total: number | null;
}

/** THUMBNAIL_READY event payload */
export interface ThumbnailReadyData {
  fileId: number;
  thumbnailPath: string;
  identity: ThumbnailIdentity;
  contentRevision: number;
}

export const THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE = 256;

/** Larger path invalidations emit multiple events; modelPaths and thumbnailPaths are independent sets, not paired. */
export type ThumbnailInvalidatedData =
  | { kind: "all" }
  | {
      kind: "paths";
      /** Independent sets; entries are not positionally paired. Each array has at most the shared batch size. */
      modelPaths: string[];
      thumbnailPaths: string[];
    };

/** THUMBNAIL_PROGRESS event payload */
export interface ThumbnailProgressData {
  current: number;
  total: number;
  filename: string;
  phase: "start" | "progress" | "done";
  outcome: "running" | "completed" | "partial" | "failed" | "cancelled";
  generated: number;
  failed: number;
  cancelled: number;
  pending: number;
}

/** GENERATE_THUMBNAIL_REQUEST event payload */
export interface ThumbnailRequestData {
  filePath: string;
  ext: string;
  thumbPath: string;
  color: string;
  requestId: string;
  cacheKey: ThumbnailCacheKey;
  cacheEpoch: number;
  size: ThumbnailSize;
  contentRevision: number;
}

/** THUMBNAIL_GENERATED result sent back from renderer */
export interface ThumbnailResultData {
  filePath: string;
  thumbPath: string;
  success: boolean;
  requestId: string;
  cacheKey: ThumbnailCacheKey;
  cacheEpoch: number;
  dataUrl?: string;
}

export interface SerializedAttribute {
  array: Float32Array;
  itemSize: number;
  normalized: boolean;
}

export interface SerializedIndex {
  array: Uint16Array | Uint32Array;
  itemSize: number;
}

export interface SerializedGeometry {
  attributes: Record<string, SerializedAttribute>;
  index: SerializedIndex | null;
}

export interface SerializedMesh {
  geometry: SerializedGeometry;
  name: string;
}

export interface PreparedPreviewMeshes {
  meshes: SerializedMesh[];
  orientation: import("./previewContracts").PreviewOrientationTransform;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  preparationDurationMs?: number;
  measurements?: import("./measurementContracts").ModelMeasurement;
}

export type PreviewParseRequestData = PreviewParseRequest;
export type PreviewParseCancelRequestData = PreviewParseCancelRequest;

export interface PreviewParseDispatchData {
  request: PreviewParseRequest;
  sourceBuffer?: ArrayBuffer;
}

export interface PreviewParsePortData {
  requestId: string;
}

export interface PreviewParseSettlementData {
  requestId: string;
  error?: string;
}

export type PreviewParseControlData =
  | { requestId: string; type: "cancelled"; reason: string }
  | { requestId: string; type: "error"; error: string };

export interface PreviewMetricData {
  source: "hidden-renderer" | "viewer";
  phase:
    | "fetch"
    | "parse"
    | "serialize"
    | "background-total"
    | "background-wait"
    | "prepare"
    | "build"
    | "first-render"
    | "preview-total";
  filePath: string;
  ext: string;
  durationMs: number;
  /** Synchronous renderer submission time for the first visible frame; GPU completion is asynchronous. */
  renderSubmitMs?: number;
  meshCount?: number;
  payloadBytes?: number;
}

export interface RuntimeSettingsData {
  thumbnail_timeout: number;
  scanning_batch_size: number;
  watcher_stability: number;
  page_size: number;
  thumbnailColor: string;
  thumbQuality?: "128" | "256" | "512";
}

export interface UpdateFileMetadataData {
  id: number;
  tags?: string[] | null;
  notes?: string | null;
}

export interface MainWindowVisibilityData {
  visible: boolean;
  revision: number;
}

// Domain contracts are re-exported here as the stable shared type entrypoint.
export type {
  LibrarySortField,
  SortDirection,
  LibraryQuery,
  LibraryFileItem,
  LibraryArchiveItem,
  LibraryItem,
  LibraryPageResult,
  LibraryQueryClient,
  IndexRepository,
  IndexBatch,
  IndexBatchResult,
  IndexInput,
  WatchUpdate,
  IndexMutationResult,
  RevisionGuardedMetadataUpdate,
  RevisionGuardedMetadataResult,
  MetadataEnrichmentUpdate,
  MetadataEnrichmentResult,
  PruneCandidate,
} from "./libraryQuery";
export type {
  BackgroundJobKind,
  BackgroundJobState,
  BackgroundJobErrorPhase,
  BackgroundJobError,
  BackgroundJobCounts,
  BackgroundJob,
  BackgroundJobCommandResult,
  DiscoveryEvent,
  DiscoveredModel,
  ThumbnailJobRequest,
  ThumbnailJobs,
  ThumbnailJobResult,
  ScanJobs,
  BackgroundJobControls,
  ThumbnailJobControls,
} from "./backgroundJobs";
export type {
  ThumbnailSize,
  ThumbnailIdentity,
  ThumbnailCacheKey,
  ThumbnailAttempt,
  ThumbnailGenerationResult,
  ThumbnailJobCoordinator,
} from "./thumbnailContracts";
export type {
  PreviewParseRequest,
  PreviewParseCancelRequest,
  PreparedPreview,
  PreviewParsePortMessage,
  PreviewParseStrategyClient,
  PreviewParseTransportClient,
  PreviewOrientationTransform,
} from "./previewContracts";
export type {
  MeasurementUnit,
  MeasurementStatus,
  ModelMeasurement,
  MeasurementEnrichmentRequest,
} from "./measurementContracts";
export type {
  SlicerConfiguration,
  SlicerHandoffResult,
  SlicerHandoffRequest,
  MetadataBackupV1,
  MetadataBackupSnapshot,
  MetadataBackupExportResult,
  MetadataImportPlan,
  StagedMetadataRestore,
  MetadataImportCommitResult,
  MetadataImportCancelResult,
  MetadataImportRecoveryResult,
  MetadataRestoreAcknowledgeResult,
  MetadataBackupService,
} from "./backupContracts";
