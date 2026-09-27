export type BackgroundJobKind = "scan" | "thumbnail";
export type BackgroundJobState = "queued" | "running" | "pausing" | "paused" | "cancelling" | "cancelled" | "completed" | "partial" | "failed";
export type BackgroundJobErrorPhase = "discovery" | "indexing" | "metadata" | "thumbnail" | "pruning";

export interface BackgroundJobError {
  path: string | null;
  phase: BackgroundJobErrorPhase;
  code: string;
  message: string;
  retryable: boolean;
}

export interface BackgroundJobCounts {
  discovered: number;
  indexed: number;
  indexFailed: number;
  thumbnailsSucceeded: number;
  thumbnailsFailed: number;
  thumbnailsPending: number;
}

export interface BackgroundJob {
  jobId: string;
  kind: BackgroundJobKind;
  rootPath: string | null;
  scopePath: string | null;
  state: BackgroundJobState;
  counts: BackgroundJobCounts;
  errors: BackgroundJobError[];
  startedAt: number | null;
  updatedAt: number;
}

export type DiscoveryEvent =
  | { type: "file"; rootPath: string; scopePath: string; file: DiscoveredModel }
  | { type: "scope-complete"; rootPath: string; scopePath: string; generation: number }
  | { type: "scope-error"; rootPath: string; scopePath: string; phase: "discovery"; reason: string; code: string }
  | { type: "discovery-complete"; rootPath: string; cancelled: boolean };

export interface DiscoveredModel {
  path: string;
  directory: string;
  archivePath: string | null;
  name: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface ThumbnailJobRequest {
  requestId: string;
  fileId: number;
  path: string;
  contentRevision: number;
  priority: "background" | "watch" | "manual";
}

export interface ThumbnailJobs {
  enqueue(request: ThumbnailJobRequest): Promise<ThumbnailJobResult>;
  pause(jobId: string): Promise<void>;
  resume(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  retryFailures(jobId: string): Promise<void>;
}

export type ThumbnailJobResult =
  | { status: "completed"; thumbnailPath: string }
  | { status: "cancelled" }
  | { status: "failed"; error: BackgroundJobError };

export interface ScanJobs {
  getBackgroundJobs(): Promise<BackgroundJob[]>;
  onBackgroundJobChanged(callback: (job: BackgroundJob) => void): () => void;
  pauseJob(jobId: string): Promise<void>;
  resumeJob(jobId: string): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  retryJobFailures(jobId: string): Promise<void>;
}
