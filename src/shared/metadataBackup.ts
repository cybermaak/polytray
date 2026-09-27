import path from 'path';
import type { MetadataBackupSnapshot, MetadataBackupV1 } from './backupContracts';
import { normalizeFileTags } from './fileTags';
import { normalizeCollectionsState } from './libraryCollections';
import { normalizeLibraryState } from './libraryState';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from './settings';
import { ARCHIVE_ENTRY_SEPARATOR, parseArchiveEntryPath } from './archivePaths';

export interface MetadataBackupAnnotation {
  path: string;
  tags: string[];
  notes: string | null;
  printStatus?: string;
}

export interface MetadataBackupDocumentV1 extends MetadataBackupV1 {
  manifest: {
    backupType: 'metadata-only';
    sourceModelsIncluded: false;
    statement: string;
  };
}

export interface BuildMetadataBackupInput {
  exportedAt: string;
  appVersion: string;
  snapshot: MetadataBackupSnapshot;
  indexedAnnotations: MetadataBackupAnnotation[];
  pendingAnnotations: MetadataBackupAnnotation[];
}

declare const normalizedSnapshotBrand: unique symbol;
export type NormalizedMetadataBackupSnapshot = MetadataBackupSnapshot & {
  readonly [normalizedSnapshotBrand]: true;
};

const BACKUP_PREFERENCE_KEYS = [
  'lightMode', 'gridSize', 'autoScan', 'accentColor', 'previewColor',
  'thumbnailColor', 'thumbQuality', 'showGrid', 'watch',
] as const;

export const METADATA_BACKUP_FORMAT = 'polytray-metadata-backup' as const;
export const METADATA_BACKUP_MAX_BYTES = 50 * 1024 * 1024;
export const METADATA_BACKUP_MAX_ANNOTATIONS = 250_000;
export const METADATA_BACKUP_MANIFEST_STATEMENT =
  'This is a metadata backup; source model files are not included.';

export function canonicalizeBackupPath(value: string): string {
  if (!value || !value.trim()) throw new Error('Backup path must not be empty');
  const separatorIndex = value.indexOf(ARCHIVE_ENTRY_SEPARATOR);
  if (separatorIndex < 0) return canonicalizePhysicalPath(value);
  if (!parseArchiveEntryPath(value)) throw new Error('Invalid archive member path');
  const archivePath = value.slice(0, separatorIndex);
  const memberIdentifier = value.slice(separatorIndex + ARCHIVE_ENTRY_SEPARATOR.length);
  if (!memberIdentifier) throw new Error('Archive member path must not be empty');
  return `${canonicalizePhysicalPath(archivePath)}${ARCHIVE_ENTRY_SEPARATOR}${memberIdentifier}`;
}

function canonicalizePhysicalPath(value: string) {
  const hasWindowsDrive = /^[A-Za-z]:[\\/]/.test(value);
  const hasUncAuthority = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value);
  if (hasWindowsDrive || hasUncAuthority) return path.win32.normalize(value);
  if (path.posix.isAbsolute(value)) return path.posix.normalize(value);
  throw new Error(`Backup physical paths must be absolute: ${value}`);
}

function stableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalUniquePaths(values: string[]) {
  return [...new Set(values.map(canonicalizeBackupPath))];
}

function normalizeAnnotationList(entries: MetadataBackupAnnotation[]): MetadataBackupAnnotation[] {
  const byPath = new Map<string, MetadataBackupAnnotation>();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.notes !== 'string' && entry.notes !== null ||
      !Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== 'string') ||
      entry.printStatus !== undefined && typeof entry.printStatus !== 'string') {
      throw new Error('Invalid backup annotation');
    }
    const canonicalPath = canonicalizeBackupPath(entry.path);
    const tags = normalizeFileTags(entry.tags);
    const printStatus = entry.printStatus;
    const current = byPath.get(canonicalPath);
    if (!current) {
      byPath.set(canonicalPath, { path: canonicalPath, tags, notes: entry.notes, ...(printStatus !== undefined ? { printStatus } : {}) });
      continue;
    }
    if (current.notes !== entry.notes) {
      throw new Error(`Conflicting duplicate annotation notes for ${canonicalPath}`);
    }
    if (current.printStatus !== undefined && printStatus !== undefined && current.printStatus !== printStatus) {
      throw new Error(`Conflicting duplicate annotation print status for ${canonicalPath}`);
    }
    current.tags = normalizeFileTags([...current.tags, ...tags]);
    if (current.printStatus === undefined && printStatus !== undefined) current.printStatus = printStatus;
  }
  return [...byPath.values()].sort((left, right) => stableCompare(left.path, right.path));
}

export function normalizeMetadataBackupSnapshot(input: unknown): MetadataBackupSnapshot {
  if (!input || typeof input !== 'object') throw new Error('Invalid metadata backup snapshot');
  const raw = input as Partial<MetadataBackupSnapshot>;
  if (!Number.isSafeInteger(raw.rendererRevision) || (raw.rendererRevision as number) < 0) {
    throw new Error('Invalid metadata backup renderer revision');
  }
  if (!Array.isArray(raw.collections)) throw new Error('Invalid metadata backup collections');
  const collectionsState = normalizeCollectionsState({
    collections: raw.collections.map((collection) => ({
      id: collection?.id,
      name: collection?.name,
      filePaths: collection?.paths,
    })),
  });
  const normalizedSettings = normalizeAppSettings({
    ...DEFAULT_APP_SETTINGS,
    ...(raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}),
  });
  const preferenceValues: Record<string, unknown> = {};
  const rawPreferences = (raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}) as Record<string, unknown>;
  for (const key of BACKUP_PREFERENCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rawPreferences, key)) {
      preferenceValues[key] = normalizedSettings[key];
    }
  }
  const preferences = preferenceValues as MetadataBackupV1['preferences'];
  const library = normalizeLibraryState({ libraryFolders: raw.libraryRoots });
  return {
    rendererRevision: raw.rendererRevision as number,
    libraryRoots: canonicalUniquePaths(library.libraryFolders),
    collections: collectionsState.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      paths: canonicalUniquePaths(collection.filePaths),
    })),
    preferences,
  };
}

export function parseMetadataBackupSnapshot(input: unknown): NormalizedMetadataBackupSnapshot {
  if (!input || typeof input !== 'object') throw new Error('Invalid metadata backup snapshot');
  const raw = input as Partial<MetadataBackupSnapshot>;
  if (!Number.isSafeInteger(raw.rendererRevision) || (raw.rendererRevision as number) < 0) {
    throw new Error('Invalid metadata backup renderer revision');
  }
  if (!Array.isArray(raw.libraryRoots) || raw.libraryRoots.some((root) => typeof root !== 'string' || !root.trim())) {
    throw new Error('Invalid metadata backup library roots');
  }
  if (!Array.isArray(raw.collections) || raw.collections.some((collection) =>
    !collection || typeof collection.id !== 'string' || !collection.id.trim() ||
    typeof collection.name !== 'string' || !collection.name.trim() ||
    !Array.isArray(collection.paths) || collection.paths.some((entry) => typeof entry !== 'string' || !entry.trim()))) {
    throw new Error('Invalid metadata backup collection paths');
  }
  if (raw.preferences !== undefined && (!raw.preferences || typeof raw.preferences !== 'object' || Array.isArray(raw.preferences))) {
    throw new Error('Invalid metadata backup preferences');
  }
  const preferences = (raw.preferences ?? {}) as Record<string, unknown>;
  for (const key of BACKUP_PREFERENCE_KEYS) {
    if (!(key in preferences)) continue;
    const value = preferences[key];
    if (['lightMode', 'autoScan', 'showGrid', 'watch'].includes(key) && typeof value !== 'boolean') {
      throw new Error(`Invalid metadata backup preference: ${key}`);
    }
    if (key === 'gridSize' && !['small', 'medium', 'large'].includes(String(value))) {
      throw new Error(`Invalid metadata backup preference: ${key}`);
    }
    if (key === 'thumbQuality' && !['128', '256', '512'].includes(String(value))) {
      throw new Error(`Invalid metadata backup preference: ${key}`);
    }
    if (['accentColor', 'previewColor', 'thumbnailColor'].includes(key) &&
      (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))) {
      throw new Error(`Invalid metadata backup preference: ${key}`);
    }
  }
  return normalizeMetadataBackupSnapshot(raw) as NormalizedMetadataBackupSnapshot;
}

export function buildMetadataBackupV1(input: BuildMetadataBackupInput): MetadataBackupDocumentV1 {
  return buildMetadataBackupV1FromNormalizedSnapshot({
    ...input,
    snapshot: parseMetadataBackupSnapshot(input.snapshot),
  });
}

export function buildMetadataBackupV1FromNormalizedSnapshot(
  input: Omit<BuildMetadataBackupInput, 'snapshot'> & { snapshot: NormalizedMetadataBackupSnapshot },
): MetadataBackupDocumentV1 {
  if (!Number.isFinite(Date.parse(input.exportedAt))) throw new Error('Invalid export timestamp');
  if (!input.appVersion.trim()) throw new Error('Invalid app version');
  const snapshot = input.snapshot;
  return {
    format: METADATA_BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date(input.exportedAt).toISOString(),
    appVersion: input.appVersion.trim(),
    annotations: normalizeAnnotationList(input.indexedAnnotations),
    pendingAnnotations: normalizeAnnotationList(input.pendingAnnotations),
    collections: snapshot.collections,
    libraryRoots: snapshot.libraryRoots,
    preferences: snapshot.preferences,
    manifest: {
      backupType: 'metadata-only',
      sourceModelsIncluded: false,
      statement: METADATA_BACKUP_MANIFEST_STATEMENT,
    },
  };
}

export function validateMetadataBackupV1(input: unknown): MetadataBackupDocumentV1 {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > METADATA_BACKUP_MAX_BYTES) throw new Error('Metadata backup exceeds 50 MiB limit');
    try { input = JSON.parse(input) as unknown; } catch { throw new Error('Malformed metadata backup JSON'); }
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > METADATA_BACKUP_MAX_BYTES) throw new Error('Metadata backup exceeds 50 MiB limit');
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input)) as unknown; } catch { throw new Error('Malformed metadata backup JSON'); }
  }
  if (!input || typeof input !== 'object') throw new Error('Invalid metadata backup document');
  const raw = input as Partial<MetadataBackupDocumentV1>;
  if (raw.format !== METADATA_BACKUP_FORMAT) throw new Error('Invalid metadata backup format');
  if (raw.version !== 1) throw new Error(`Unsupported metadata backup version: ${String(raw.version)}`);
  if (typeof raw.exportedAt !== 'string' || typeof raw.appVersion !== 'string') throw new Error('Invalid metadata backup metadata');
  const pendingAnnotations = raw.pendingAnnotations ?? [];
  if (!Array.isArray(raw.annotations) || !Array.isArray(pendingAnnotations) || !Array.isArray(raw.collections) || !Array.isArray(raw.libraryRoots)) {
    throw new Error('Invalid metadata backup arrays');
  }
  if (raw.annotations.length + pendingAnnotations.length > METADATA_BACKUP_MAX_ANNOTATIONS) {
    throw new Error('Metadata backup exceeds 250,000 annotation limit');
  }
  if (raw.collections.some(collection => !collection || typeof collection.id !== 'string' || !collection.id.trim() ||
    typeof collection.name !== 'string' || !collection.name.trim() || !Array.isArray(collection.paths) ||
    collection.paths.some(entry => typeof entry !== 'string' || !entry.trim()))) {
    throw new Error('Invalid metadata backup collections');
  }
  for (const list of [raw.annotations, pendingAnnotations]) {
    const identities = new Set<string>();
    for (const entry of list) {
      if (!entry || typeof entry.path !== 'string') throw new Error('Invalid backup annotation');
      const identity = canonicalizeBackupPath(entry.path);
      if (identities.has(identity)) throw new Error(`Duplicate annotation identity: ${identity}`);
      identities.add(identity);
    }
  }
  if (!raw.manifest || raw.manifest.backupType !== 'metadata-only' || raw.manifest.sourceModelsIncluded !== false || typeof raw.manifest.statement !== 'string') {
    throw new Error('Invalid metadata backup manifest');
  }
  return buildMetadataBackupV1({
    exportedAt: raw.exportedAt,
    appVersion: raw.appVersion,
    indexedAnnotations: raw.annotations,
    pendingAnnotations,
    snapshot: {
      rendererRevision: 0,
      libraryRoots: raw.libraryRoots,
      collections: raw.collections,
      preferences: raw.preferences ?? {},
    },
  });
}

/** Serialize a document already created by the builder or checked by the V1 validator. */
export function serializeMetadataBackup(input: MetadataBackupDocumentV1): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}
