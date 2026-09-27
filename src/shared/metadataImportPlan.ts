import type { MetadataImportAnnotationUpdate, MetadataImportPlan } from './backupContracts';
import { canonicalizeBackupPath, type MetadataBackupAnnotation, validateMetadataBackupV1 } from './metadataBackup';
import { normalizeFileTags } from './fileTags';
import { normalizeAppSettings } from './settings';

export interface ImportRendererState {
  libraryRoots: string[];
  collections: Array<{ id: string; name: string; paths: string[] }>;
  preferences: Record<string, unknown>;
}
export interface ImportCurrentState {
  /** D01 browseRevision advances for indexed annotation mutations. */
  databaseBrowseRevision: number;
  rendererRevision: number;
  /** Must include every indexed file row, including rows with no annotation values. */
  annotations: MetadataBackupAnnotation[];
  pendingAnnotations: MetadataBackupAnnotation[];
  rendererState: ImportRendererState;
}
export interface MetadataImportPlanInput {
  backup: unknown;
  current: ImportCurrentState;
  transactionId?: string;
  options?: { replaceSettings?: boolean; replaceRoots?: boolean };
}

const PORTABLE_KEYS = ['lightMode','gridSize','autoScan','accentColor','previewColor','thumbnailColor','thumbQuality','showGrid','watch'] as const;
const stable = (value: unknown) => JSON.stringify(value);
function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function fingerprint(value: string): string {
  const first = hash(value);
  const second = hash(`p03:${value}`);
  const third = hash(`${value.length}:${value}`);
  const fourth = hash(`${first}:${second}:${third}:${value}`);
  return `${first}${second}${third}${fourth}`;
}
function normalizedAnnotation(record: MetadataBackupAnnotation): MetadataBackupAnnotation {
  return {
    path: canonicalizeBackupPath(record.path),
    tags: normalizeFileTags(record.tags),
    notes: record.notes?.trim() || null,
    ...(record.printStatus !== undefined ? { printStatus: record.printStatus.trim() } : {}),
  };
}
function same(a: unknown, b: unknown) { return stable(a) === stable(b); }
function completeCurrentSettings(raw: Record<string, unknown>): Record<string, unknown> {
  // Keep local-only/future fields (such as slicer paths and panel widths), while
  // normalizing every key owned by AppSettings.
  return { ...raw, ...normalizeAppSettings(raw) };
}
function importedSettingsOverlay(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PORTABLE_KEYS.filter(key => Object.prototype.hasOwnProperty.call(settings, key)).map(key => [key, settings[key]]));
}

function mergeAnnotation(existingRaw: MetadataBackupAnnotation | null, incomingRaw: MetadataBackupAnnotation,
  path: string, conflicts: MetadataImportPlan['annotationConflicts']): MetadataBackupAnnotation {
  const incoming = normalizedAnnotation(incomingRaw);
  const existing = existingRaw ? normalizedAnnotation(existingRaw) : null;
  if (!existing) return incoming;
  const after: MetadataBackupAnnotation = {
    path,
    tags: normalizeFileTags([...existing.tags, ...incoming.tags]),
    notes: existing.notes,
    ...(existing.printStatus !== undefined ? { printStatus: existing.printStatus } : {}),
  };
  if (!existing.notes && incoming.notes) after.notes = incoming.notes;
  else if (existing.notes && incoming.notes && existing.notes !== incoming.notes) {
    conflicts.push({ path, field: 'notes', existing: existing.notes, incoming: incoming.notes });
  }
  const currentStatus = existing.printStatus;
  const importedStatus = incoming.printStatus;
  if ((!currentStatus || currentStatus === 'Not Printed') && importedStatus && importedStatus !== 'Not Printed') after.printStatus = importedStatus;
  else if (currentStatus && currentStatus !== 'Not Printed' && importedStatus && importedStatus !== currentStatus) {
    conflicts.push({ path, field: 'printStatus', existing: currentStatus, incoming: importedStatus });
  }
  return after;
}

function normalizeCollection(collection: ImportRendererState['collections'][number]) {
  return {
    id: collection.id,
    name: collection.name.trim(),
    paths: [...new Set(collection.paths.map(canonicalizeBackupPath))],
  };
}

export function createMetadataImportPlan(input: MetadataImportPlanInput): MetadataImportPlan {
  const backup = validateMetadataBackupV1(input.backup);
  const current = input.current;
  const indexed = new Map<string, MetadataBackupAnnotation>();
  for (const annotation of current.annotations) {
    const normalized = normalizedAnnotation(annotation);
    indexed.set(normalized.path, normalized);
  }
  const pending = new Map<string, MetadataBackupAnnotation>();
  for (const annotation of current.pendingAnnotations) {
    const normalized = normalizedAnnotation(annotation);
    pending.set(normalized.path, normalized);
  }

  const updates = new Map<string, MetadataImportAnnotationUpdate>();
  const conflicts: MetadataImportPlan['annotationConflicts'] = [];
  const applySource = (source: 'annotations' | 'pendingAnnotations', records: MetadataBackupAnnotation[]) => {
    for (const raw of records) {
      const incoming = normalizedAnnotation(raw);
      const path = incoming.path;
      const destination = indexed.has(path) ? 'indexed' : 'pending';
      const existing = destination === 'indexed' ? indexed.get(path)! : pending.get(path) ?? null;
      const previous = updates.get(path);
      const before = previous ? previous.before : existing;
      const mergeBase = previous?.after ?? existing;
      const after = mergeAnnotation(mergeBase, incoming, path, conflicts);
      const sources = previous ? [...previous.sources] : [];
      if (!sources.includes(source)) sources.push(source);
      updates.set(path, {
        path,
        destination,
        before,
        after,
        sources,
        changed: !same(before, after),
      });
    }
  };
  // Source order is part of the merge contract: current row, then indexed backup,
  // then pending backup. Existing nonempty values win all note/status conflicts.
  applySource('annotations', backup.annotations);
  applySource('pendingAnnotations', backup.pendingAnnotations);

  const allUpdates = [...updates.values()];
  const annotationUpdates = allUpdates.filter(update => update.destination === 'indexed');
  const pendingAnnotationUpdates = allUpdates.filter(update => update.destination === 'pending');
  const changedAnnotationUpdates = allUpdates.filter(update => update.changed);
  const unchangedAnnotationUpdates = allUpdates.filter(update => !update.changed);

  const collectionsBefore = current.rendererState.collections.map(normalizeCollection);
  const collectionsAfter = collectionsBefore.map(collection => ({ ...collection, paths: [...collection.paths] }));
  const collectionsById = new Map(collectionsAfter.map(collection => [collection.id, collection]));
  const remaps: MetadataImportPlan['collectionIdRemaps'] = [];
  const mergePaths = (target: typeof collectionsAfter[number], importedPaths: string[]) => {
    target.paths = [...new Set([...target.paths, ...importedPaths.map(canonicalizeBackupPath)])];
  };
  for (const imported of backup.collections) {
    const existing = collectionsById.get(imported.id);
    if (existing?.name === imported.name) {
      mergePaths(existing, imported.paths);
      continue;
    }
    let id = imported.id;
    if (existing && existing.name !== imported.name) {
      const baseId = `import-${hash(`${backup.exportedAt}|${backup.appVersion}|${imported.id}|${imported.name}`)}`;
      id = baseId;
      let collision = 0;
      while (collectionsById.has(id) && collectionsById.get(id)!.name !== imported.name) {
        id = `import-${hash(`${baseId}|${++collision}`)}`;
      }
      remaps.push({ oldId: imported.id, newId: id, name: imported.name });
      const remapped = collectionsById.get(id);
      if (remapped) {
        mergePaths(remapped, imported.paths);
        continue;
      }
    }
    const added = { id, name: imported.name, paths: [...new Set(imported.paths.map(canonicalizeBackupPath))] };
    collectionsAfter.push(added);
    collectionsById.set(id, added);
  }

  const settingsBefore = completeCurrentSettings(current.rendererState.preferences);
  const settingsAfter = input.options?.replaceSettings
    ? { ...settingsBefore, ...normalizeAppSettings({ ...settingsBefore, ...importedSettingsOverlay(backup.preferences as Record<string, unknown>) }) }
    : settingsBefore;
  const rootsBefore = [...new Set(current.rendererState.libraryRoots.map(canonicalizeBackupPath))];
  const rootsAfter = input.options?.replaceRoots ? [...new Set(backup.libraryRoots)] : [...rootsBefore];
  const inputRevision = fingerprint(stable({ backup, current }));

  return {
    transactionId: input.transactionId ?? `plan-${inputRevision}`,
    inputRevision,
    currentBrowseRevision: current.databaseBrowseRevision,
    currentRendererRevision: current.rendererRevision,
    matchedAnnotationCount: annotationUpdates.length,
    changedAnnotationCount: changedAnnotationUpdates.length,
    pendingAnnotationCount: pendingAnnotationUpdates.length,
    conflictCount: conflicts.length,
    unmatchedPaths: pendingAnnotationUpdates.map(update => update.path),
    annotationUpdates,
    pendingAnnotationUpdates,
    changedAnnotationUpdates,
    unchangedAnnotationUpdates,
    annotationConflicts: conflicts,
    collectionIdRemaps: remaps,
    collectionsBefore,
    collectionsAfter,
    settingsBefore,
    settingsAfter,
    rootsBefore,
    rootsAfter,
    replaceSettings: input.options?.replaceSettings ?? false,
    replaceRoots: input.options?.replaceRoots ?? false,
  };
}

export function isMetadataImportPlanCurrent(plan: MetadataImportPlan, revisions: { browseRevision: number; rendererRevision: number }): boolean {
  return plan.currentBrowseRevision === revisions.browseRevision &&
    plan.currentRendererRevision === revisions.rendererRevision;
}
