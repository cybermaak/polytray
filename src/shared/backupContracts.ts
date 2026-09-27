import type { AppSettings } from "./settings";
import type { ModelMeasurement } from "./measurementContracts";

export interface SlicerConfiguration {
  applicationPath: string | null;
  useSystemDefault: boolean;
}

export type SlicerHandoffResult =
  | { status: "launched"; handoffPath: string }
  | { status: "cancelled" }
  | { status: "failed"; code: "missing-source" | "unsupported-format" | "unsafe-archive-entry" | "size-limit" | "launch-failed"; message: string };

export interface SlicerHandoffRequest {
  fileId: number;
  path: string;
  extension: string;
}

export interface MetadataBackupV1 {
  format: "polytray-metadata-backup";
  version: 1;
  exportedAt: string;
  appVersion: string;
  annotations: Array<{ path: string; tags: string[]; notes: string | null; printStatus?: string }>;
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

export interface MetadataImportPlan {
  transactionId: string;
  inputRevision: string;
  currentRendererRevision: number;
  matchedAnnotationCount: number;
  changedAnnotationCount: number;
  pendingAnnotationCount: number;
  conflictCount: number;
  unmatchedPaths: string[];
  annotationConflicts: Array<{ path: string; field: "notes" | "printStatus"; existing: string; incoming: string }>;
  collectionIdRemaps: Array<{ oldId: string; newId: string; name: string }>;
  replaceSettings: boolean;
  replaceRoots: boolean;
}

export interface StagedMetadataRestore {
  transactionId: string;
  rendererRevision: number;
  settings: MetadataBackupV1["preferences"];
  libraryRoots: string[];
  collections: MetadataBackupV1["collections"];
  pendingAnnotations: MetadataBackupV1["annotations"];
}

export type MetadataImportCommitResult =
  | { status: "staged"; rendererState: StagedMetadataRestore }
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

export type { ModelMeasurement };
