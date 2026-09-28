import { createHash } from 'node:crypto';
import type { MetadataImportAnnotationUpdate, MetadataImportPlan } from './backupContracts';
import { canonicalizeBackupPath, type MetadataBackupAnnotation, validateMetadataBackupV1 } from './metadataBackup';
import { ARCHIVE_ENTRY_SEPARATOR } from './archivePaths';
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
  /** Main-process row IDs and content revisions captured with the indexed snapshot. */
  indexedIdentities?: Array<{ id: number; path: string; contentRevision: number }>;
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
function canonicalIdentityKey(value: string): string {
  const canonical = canonicalizeBackupPath(value);
  const separator = canonical.indexOf(ARCHIVE_ENTRY_SEPARATOR);
  const physicalPath = separator < 0 ? canonical : canonical.slice(0, separator);
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(physicalPath) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(physicalPath);
  if (!isWindowsPath) return canonical;
  let physicalKey = physicalPath.toLowerCase().replace(/[\\/]+$/, '');
  if (/^[a-z]:$/.test(physicalKey)) physicalKey += '\\';
  return separator < 0
    ? physicalKey
    : `${physicalKey}${ARCHIVE_ENTRY_SEPARATOR}${canonical.slice(separator + ARCHIVE_ENTRY_SEPARATOR.length)}`;
}
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function normalizedAnnotation(record: MetadataBackupAnnotation): MetadataBackupAnnotation {
  return {
    path: canonicalizeBackupPath(record.path),
    tags: normalizeFileTags(record.tags),
    notes: record.notes === null || record.notes.trim() === '' ? null : record.notes,
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

function copyCurrentCollection(collection: ImportRendererState['collections'][number]) {
  return {
    id: collection.id,
    name: collection.name,
    paths: [...collection.paths],
  };
}

export function createMetadataImportPlan(input: MetadataImportPlanInput): MetadataImportPlan {
  const backup = validateMetadataBackupV1(input.backup);
  const current = input.current;
  const indexed = new Map<string, MetadataBackupAnnotation>();
  for (const annotation of current.annotations) {
    const normalized = normalizedAnnotation(annotation);
    indexed.set(canonicalIdentityKey(normalized.path), normalized);
  }
  const pending = new Map<string, MetadataBackupAnnotation>();
  for (const annotation of current.pendingAnnotations) {
    const normalized = normalizedAnnotation(annotation);
    pending.set(canonicalIdentityKey(normalized.path), normalized);
  }

  const updates = new Map<string, MetadataImportAnnotationUpdate>();
  const conflicts: MetadataImportPlan['annotationConflicts'] = [];
  const applySource = (source: 'annotations' | 'pendingAnnotations', records: MetadataBackupAnnotation[]) => {
    for (const raw of records) {
      const incoming = normalizedAnnotation(raw);
      const path = incoming.path;
      const identity = canonicalIdentityKey(path);
      const destination = indexed.has(identity) ? 'indexed' : 'pending';
      const existing = destination === 'indexed' ? indexed.get(identity)! : pending.get(identity) ?? null;
      const previous = updates.get(identity);
      const before = previous ? previous.before : existing;
      const mergeBase = previous?.after ?? existing;
      const after = mergeAnnotation(mergeBase, incoming, path, conflicts);
      const sources = previous ? [...previous.sources] : [];
      if (!sources.includes(source)) sources.push(source);
      updates.set(identity, {
        path: previous?.path ?? path,
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
  const indexedUpdateKeys = new Set(annotationUpdates.map(update => canonicalIdentityKey(update.path)));
  const identityByKey = new Map<string, NonNullable<ImportCurrentState['indexedIdentities']>[number]>();
  for (const identity of current.indexedIdentities ?? []) {
    const key = canonicalIdentityKey(identity.path);
    if (identityByKey.has(key)) throw new Error(`Ambiguous indexed file identity in restore snapshot: ${identity.path}`);
    identityByKey.set(key, identity);
  }
  const indexedIdentityExpectations = [...indexedUpdateKeys].map(key => identityByKey.get(key)).filter((value): value is NonNullable<typeof value> => value !== undefined);
  if (current.indexedIdentities && indexedIdentityExpectations.length !== indexedUpdateKeys.size) {
    throw new Error('Indexed identity snapshot is missing a planned restore target');
  }

  const collectionsBefore = current.rendererState.collections.map(copyCurrentCollection);
  const collectionsAfter = collectionsBefore.map(collection => ({ ...collection, paths: [...collection.paths] }));
  const collectionsById = new Map(collectionsAfter.map(collection => [collection.id, collection]));
  const remaps: MetadataImportPlan['collectionIdRemaps'] = [];
  const currentPathSpellings = new Map<string, string>();
  for (const annotation of current.annotations) {
    currentPathSpellings.set(canonicalIdentityKey(annotation.path), annotation.path);
  }
  for (const collection of collectionsBefore) {
    for (const path of collection.paths) {
      const identity = canonicalIdentityKey(path);
      if (!currentPathSpellings.has(identity)) currentPathSpellings.set(identity, path);
    }
  }
  const mergePaths = (target: typeof collectionsAfter[number], importedPaths: string[]) => {
    const members = new Set(target.paths.map(canonicalIdentityKey));
    for (const importedPath of importedPaths) {
      const identity = canonicalIdentityKey(importedPath);
      if (members.has(identity)) continue;
      target.paths.push(currentPathSpellings.get(identity) ?? canonicalizeBackupPath(importedPath));
      members.add(identity);
    }
  };
  for (const imported of backup.collections) {
    const existing = collectionsById.get(imported.id);
    if (existing?.name === imported.name) {
      mergePaths(existing, imported.paths);
      continue;
    }
    let id = imported.id;
    if (existing && existing.name !== imported.name) {
      const baseId = `import-${sha256(`${backup.exportedAt}|${backup.appVersion}|${imported.id}|${imported.name}`).slice(0, 16)}`;
      id = baseId;
      let collision = 0;
      while (collectionsById.has(id) && collectionsById.get(id)!.name !== imported.name) {
        id = `${baseId}-${++collision}`;
      }
      remaps.push({ oldId: imported.id, newId: id, name: imported.name });
      const remapped = collectionsById.get(id);
      if (remapped) {
        mergePaths(remapped, imported.paths);
        continue;
      }
    }
    const addedPaths: string[] = [];
    const addedPathKeys = new Set<string>();
    for (const importedPath of imported.paths) {
      const identity = canonicalIdentityKey(importedPath);
      if (addedPathKeys.has(identity)) continue;
      addedPaths.push(currentPathSpellings.get(identity) ?? canonicalizeBackupPath(importedPath));
      addedPathKeys.add(identity);
    }
    const added = { id, name: imported.name, paths: addedPaths };
    collectionsAfter.push(added);
    collectionsById.set(id, added);
  }

  const settingsBefore = completeCurrentSettings(current.rendererState.preferences);
  const options = {
    replaceSettings: input.options?.replaceSettings ?? false,
    replaceRoots: input.options?.replaceRoots ?? false,
  };
  const settingsAfter = options.replaceSettings
    ? { ...settingsBefore, ...normalizeAppSettings({ ...settingsBefore, ...importedSettingsOverlay(backup.preferences as Record<string, unknown>) }) }
    : settingsBefore;
  const rootsBefore = [...current.rendererState.libraryRoots];
  let rootsAfter = [...rootsBefore];
  if (options.replaceRoots) {
    const currentRootsByIdentity = new Map<string, string>();
    for (const root of current.rendererState.libraryRoots) {
      const identity = canonicalIdentityKey(root);
      if (!currentRootsByIdentity.has(identity)) currentRootsByIdentity.set(identity, root);
    }
    const seenRoots = new Set<string>();
    const replacementRoots: string[] = [];
    for (const importedRoot of backup.libraryRoots) {
      const identity = canonicalIdentityKey(importedRoot);
      if (seenRoots.has(identity)) continue;
      replacementRoots.push(currentRootsByIdentity.get(identity) ?? canonicalizeBackupPath(importedRoot));
      seenRoots.add(identity);
    }
    rootsAfter = replacementRoots;
  }
  const inputRevision = sha256(stable({ backup, current, options }));

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
    indexedIdentityExpectations,
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
    replaceSettings: options.replaceSettings,
    replaceRoots: options.replaceRoots,
  };
}

export function isMetadataImportPlanCurrent(plan: MetadataImportPlan, revisions: { browseRevision: number; rendererRevision: number }): boolean {
  return plan.currentBrowseRevision === revisions.browseRevision &&
    plan.currentRendererRevision === revisions.rendererRevision;
}
