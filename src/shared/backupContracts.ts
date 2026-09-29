import type { AppSettings } from "./settings";
import type { ModelMeasurement } from "./measurementContracts";

export interface SlicerConfiguration {
  applicationPath: string | null;
  useSystemDefault: boolean;
}

export type SlicerHandoffResult =
  | { status: "launched"; handoffPath: string }
  | { status: "cancelled" }
  | { status: "failed"; code: "missing-source" | "unsupported-format" | "unsafe-archive-entry" | "size-limit" | "application-unavailable" | "launch-failed"; message: string };

export interface SlicerHandoffRequest {
  requestId: string;
  fileId: number;
  path: string;
  extension: string;
  contentRevision: number;
  configuration: SlicerConfiguration | null;
}

export interface MetadataBackupV1 {
  format: "polytray-metadata-backup";
  version: 1;
  exportedAt: string;
  appVersion: string;
  annotations: Array<{ path: string; tags: string[]; notes: string | null; printStatus?: string }>;
  /** Unresolved annotations kept separate so they can overlap indexed paths without data loss. */
  pendingAnnotations: Array<{ path: string; tags: string[]; notes: string | null; printStatus?: string }>;
  collections: Array<{ id: string; name: string; paths: string[] }>;
  libraryRoots: string[];
  preferences: Partial<Pick<AppSettings, "lightMode" | "gridSize" | "autoScan" | "accentColor" | "previewColor" | "thumbnailColor" | "thumbQuality" | "showGrid" | "watch">>;
}

/** Renderer-owned normalized state supplied to the main-process export service. */
export interface MetadataBackupSnapshot {
  rendererRevision: number;
  libraryRoots: string[];
  collections: Array<{ id: string; name: string; paths: string[] }>;
  preferences: MetadataBackupV1["preferences"];
}

export type MetadataBackupExportResult =
  | { status: "exported"; location: string; annotationCount: number; collectionCount: number; pendingAnnotationCount: number }
  | { status: "cancelled" }
  | { status: "failed"; code: "invalid-snapshot" | "write-failed"; message: string };

export interface MetadataImportAnnotationUpdate {
  path: string;
  destination: "indexed" | "pending";
  before: MetadataBackupV1["annotations"][number] | null;
  after: MetadataBackupV1["annotations"][number];
  sources: Array<"annotations" | "pendingAnnotations">;
  changed: boolean;
}

export interface MetadataImportIndexedIdentityExpectation {
  id: number;
  path: string;
  contentRevision: number;
}

/** Single canonical update plan shared by preview, P04, and U06. Pending rows are upserts only. */
export interface MetadataImportPlan {
  transactionId: string;
  inputRevision: string;
  currentBrowseRevision: number;
  currentRendererRevision: number;
  matchedAnnotationCount: number;
  changedAnnotationCount: number;
  pendingAnnotationCount: number;
  conflictCount: number;
  unmatchedPaths: string[];
  annotationUpdates: MetadataImportAnnotationUpdate[];
  /** Exact indexed row identities observed when the preview was created. */
  indexedIdentityExpectations: MetadataImportIndexedIdentityExpectation[];
  pendingAnnotationUpdates: MetadataImportAnnotationUpdate[];
  changedAnnotationUpdates: MetadataImportAnnotationUpdate[];
  unchangedAnnotationUpdates: MetadataImportAnnotationUpdate[];
  annotationConflicts: Array<{ path: string; field: "notes" | "printStatus"; existing: string; incoming: string }>;
  collectionIdRemaps: Array<{ oldId: string; newId: string; name: string }>;
  collectionsBefore: MetadataBackupV1["collections"];
  collectionsAfter: MetadataBackupV1["collections"];
  settingsBefore: Record<string, unknown>;
  settingsAfter: Record<string, unknown>;
  rootsBefore: string[];
  rootsAfter: string[];
  replaceSettings: boolean;
  replaceRoots: boolean;
}

export interface StagedMetadataRestore {
  transactionId: string;
  rendererRevision: number;
  /** Complete current renderer settings, including machine-local fields to preserve. */
  settings: Record<string, unknown>;
  libraryRoots: string[];
  collections: MetadataBackupV1["collections"];
  pendingAnnotations: MetadataBackupV1["annotations"];
  annotationConflicts: MetadataImportPlan["annotationConflicts"];
  recoveryBackupPath: string;
}

export type MetadataImportCommitResult =
  | { status: "staged"; rendererState: StagedMetadataRestore }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type MetadataRestoreAcknowledgeResult =
  | { status: "acknowledged" }
  | { status: "failed"; message: string };

export type MetadataImportCancelResult =
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type MetadataImportRecoveryResult =
  | { status: "none" }
  | { status: "aborted"; transactionId: string }
  | { status: "roll-forward"; rendererState: StagedMetadataRestore }
  | { status: "blocked"; transactionId: string | null; message: string };

export interface MetadataBackupService {
  exportMetadata(snapshot: MetadataBackupSnapshot): Promise<MetadataBackupExportResult>;
  previewImport(input: Uint8Array, currentSnapshot: MetadataBackupSnapshot): Promise<MetadataImportPlan>;
  commitImport(transactionId: string): Promise<MetadataImportCommitResult>;
  acknowledgeImport(transactionId: string, rendererRevision: number): Promise<void>;
  reconcileImport(transactionId?: string): Promise<MetadataImportRecoveryResult>;
  cancelImport(transactionId: string): Promise<void>;
}

/** Main-process restore adapter consumed by coordinator IPC/startup wiring and U06. */
export interface MetadataRestoreService {
  getCurrentSnapshot(): MetadataBackupSnapshot & { preferences: Record<string, unknown> };
  previewImport(input: unknown, currentSnapshot: MetadataBackupSnapshot, options?: { replaceSettings?: boolean; replaceRoots?: boolean }): MetadataImportPlan;
  commitImport(transactionId: string): Promise<MetadataImportCommitResult>;
  acknowledgeImport(transactionId: string, rendererRevision: number): Promise<void>;
  reconcileImport(): Promise<MetadataImportRecoveryResult>;
  cancelImport(transactionId: string): Promise<void>;
  getPreparedPlanCount(): number;
  getStatus(): Promise<MetadataRestoreStatus>;
  retryPendingAnnotations(): { appliedCount: number; conflictCount: number };
  dispose(): void;
}

export interface MetadataRestoreStatus {
  unresolved: boolean;
  error: string | null;
  pendingAnnotationCount: number;
  conflicts: Array<{ path: string; conflicts: MetadataImportPlan['annotationConflicts'] }>;
  transactions: Array<{ transactionId: string; state: string; recoveryBackupPath: string }>;
}

export type { ModelMeasurement };
