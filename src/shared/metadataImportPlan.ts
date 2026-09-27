import { canonicalizeBackupPath, type MetadataBackupAnnotation, validateMetadataBackupV1 } from './metadataBackup';
import { normalizeFileTags } from './fileTags';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from './settings';

export interface ImportRendererState {
  libraryRoots: string[];
  collections: Array<{ id: string; name: string; paths: string[] }>;
  preferences: Record<string, unknown>;
}
export interface ImportCurrentState {
  databaseBrowseRevision: number;
  databaseAnnotationRevision: number;
  rendererRevision: number;
  annotations: MetadataBackupAnnotation[];
  pendingAnnotations: MetadataBackupAnnotation[];
  rendererState: ImportRendererState;
}
export interface MetadataImportPlanInput {
  backup: unknown;
  current: ImportCurrentState;
  planId?: string;
  options?: { replaceSettings?: boolean; replaceRoots?: boolean };
}
export interface PlannedAnnotation { path: string; before: MetadataBackupAnnotation | null; after: MetadataBackupAnnotation; source: 'matched' | 'unmatched-pending' | 'pending'; changed: boolean }
export interface MetadataImportPlan {
  planId: string;
  inputFingerprint: string;
  databaseBrowseRevision: number;
  databaseAnnotationRevision: number;
  rendererRevision: number;
  matched: PlannedAnnotation[];
  unmatchedPending: MetadataBackupAnnotation[];
  pendingAnnotations: PlannedAnnotation[];
  annotations: PlannedAnnotation[];
  unchanged: PlannedAnnotation[];
  changed: PlannedAnnotation[];
  annotationConflicts: Array<{ path: string; field: 'notes' | 'printStatus'; existing: string; incoming: string }>;
  collections: ImportRendererState['collections'];
  collectionIdRemaps: Array<{ oldId: string; newId: string; name: string }>;
  rendererChanges: {
    settings: { before: Record<string, unknown>; after: Record<string, unknown> };
    roots: { before: string[]; after: string[] };
    collections: { before: ImportRendererState['collections']; after: ImportRendererState['collections'] };
  };
  options: { replaceSettings: boolean; replaceRoots: boolean };
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
function portablePreferences(value: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeAppSettings({ ...DEFAULT_APP_SETTINGS, ...value });
  return Object.fromEntries(PORTABLE_KEYS.map(key => [key, normalized[key]]));
}
function normalizedAnnotation(record: MetadataBackupAnnotation): MetadataBackupAnnotation {
  return { path: canonicalizeBackupPath(record.path), tags: normalizeFileTags(record.tags), notes: record.notes?.trim() || null, ...(record.printStatus !== undefined ? { printStatus: record.printStatus.trim() } : {}) };
}
function same(a: unknown, b: unknown) { return stable(a) === stable(b); }

function mergeAnnotation(incomingRaw: MetadataBackupAnnotation, existingRaw: MetadataBackupAnnotation | undefined,
  conflicts: MetadataImportPlan['annotationConflicts']): PlannedAnnotation {
  const incoming = normalizedAnnotation(incomingRaw);
  const existing = existingRaw ? normalizedAnnotation(existingRaw) : undefined;
  if (!existing) return { path: incoming.path, before: null, after: incoming, source: 'matched', changed: true };
  const after: MetadataBackupAnnotation = { path: existing.path, tags: normalizeFileTags([...existing.tags, ...incoming.tags]), notes: existing.notes, ...(existing.printStatus !== undefined ? { printStatus: existing.printStatus } : {}) };
  if (!existing.notes && incoming.notes) after.notes = incoming.notes;
  else if (existing.notes && incoming.notes && existing.notes !== incoming.notes) conflicts.push({ path: incoming.path, field: 'notes', existing: existing.notes, incoming: incoming.notes });
  const currentStatus = existing.printStatus;
  const importedStatus = incoming.printStatus;
  if ((!currentStatus || currentStatus === 'Not Printed') && importedStatus && importedStatus !== 'Not Printed') after.printStatus = importedStatus;
  else if (currentStatus && currentStatus !== 'Not Printed' && importedStatus && importedStatus !== currentStatus) conflicts.push({ path: incoming.path, field: 'printStatus', existing: currentStatus, incoming: importedStatus });
  return { path: incoming.path, before: existing, after, source: 'matched', changed: !same(existing, after) };
}

export function createMetadataImportPlan(input: MetadataImportPlanInput): MetadataImportPlan {
  const backup = validateMetadataBackupV1(input.backup);
  const current = input.current;
  const currentByPath = new Map<string, MetadataBackupAnnotation>();
  for (const annotation of current.annotations) currentByPath.set(canonicalizeBackupPath(annotation.path), normalizedAnnotation(annotation));
  const conflicts: MetadataImportPlan['annotationConflicts'] = [];
  const planned = backup.annotations.map(annotation => mergeAnnotation(annotation, currentByPath.get(canonicalizeBackupPath(annotation.path)), conflicts));
  const matchedPaths = new Set(currentByPath.keys());
  const matchedPlans = planned.filter(item => matchedPaths.has(item.path));
  const unmatchedPending = [...backup.annotations, ...backup.pendingAnnotations]
    .filter(annotation => !matchedPaths.has(canonicalizeBackupPath(annotation.path)))
    .map(normalizedAnnotation);
  const pendingCurrent = new Map(current.pendingAnnotations.map(annotation => [canonicalizeBackupPath(annotation.path), normalizedAnnotation(annotation)]));
  const pendingPlans: PlannedAnnotation[] = backup.pendingAnnotations.map(incoming => {
    const path = canonicalizeBackupPath(incoming.path);
    const previous = pendingCurrent.get(path);
    return { ...mergeAnnotation(incoming, previous, conflicts), source: 'pending' as const };
  });
  for (const incoming of backup.annotations.filter(annotation => !matchedPaths.has(canonicalizeBackupPath(annotation.path)))) {
    const path = canonicalizeBackupPath(incoming.path);
    pendingPlans.push({ ...mergeAnnotation(incoming, pendingCurrent.get(path), conflicts), source: 'unmatched-pending' });
  }

  const beforeCollections = current.rendererState.collections.map(c => ({ id:c.id, name:c.name.trim(), paths:[...new Set(c.paths.map(canonicalizeBackupPath))].sort() }));
  const afterCollections = beforeCollections.map(c => ({ ...c, paths:[...c.paths] }));
  const remaps: MetadataImportPlan['collectionIdRemaps'] = [];
  for (const imported of backup.collections) {
    const sameId = afterCollections.find(c => c.id === imported.id);
    if (sameId?.name === imported.name) {
      const target = sameId;
      target.paths = [...new Set([...target.paths, ...imported.paths.map(canonicalizeBackupPath)])].sort();
      continue;
    }
    let id = imported.id;
    if (sameId && sameId.name !== imported.name) {
      id = `import-${hash(`${backup.exportedAt}|${backup.appVersion}|${imported.id}|${imported.name}`)}`;
      while (afterCollections.some(c => c.id === id)) id = `import-${hash(`${id}|${imported.name}`)}`;
      remaps.push({ oldId: imported.id, newId: id, name: imported.name });
    }
    afterCollections.push({ id, name: imported.name, paths: [...new Set(imported.paths.map(canonicalizeBackupPath))].sort() });
  }
  afterCollections.sort((a,b) => a.id.localeCompare(b.id));
  const beforeSettings = portablePreferences(current.rendererState.preferences);
  const importedSettings = portablePreferences({ ...beforeSettings, ...(backup.preferences as Record<string, unknown>) });
  const beforeRoots = [...new Set(current.rendererState.libraryRoots.map(canonicalizeBackupPath))].sort();
  const inputFingerprint = fingerprint(stable({ backup, current }));
  return {
    planId: input.planId ?? `plan-${inputFingerprint}`,
    inputFingerprint,
    databaseBrowseRevision: current.databaseBrowseRevision,
    databaseAnnotationRevision: current.databaseAnnotationRevision,
    rendererRevision: current.rendererRevision,
    matched: matchedPlans, unmatchedPending, pendingAnnotations: pendingPlans,
    annotations: matchedPlans,
    unchanged: [...matchedPlans, ...pendingPlans].filter(item => !item.changed),
    changed: [...matchedPlans, ...pendingPlans].filter(item => item.changed),
    annotationConflicts: conflicts,
    collections: afterCollections, collectionIdRemaps: remaps,
    rendererChanges: {
      settings: { before: beforeSettings, after: input.options?.replaceSettings ? { ...beforeSettings, ...importedSettings } : beforeSettings },
      roots: { before: beforeRoots, after: input.options?.replaceRoots ? [...new Set(backup.libraryRoots)].sort() : beforeRoots },
      collections: { before: beforeCollections, after: afterCollections },
    },
    options: { replaceSettings: input.options?.replaceSettings ?? false, replaceRoots: input.options?.replaceRoots ?? false },
  };
}

export function isMetadataImportPlanCurrent(plan: MetadataImportPlan, revisions: { databaseBrowseRevision: number; databaseAnnotationRevision: number; rendererRevision: number }): boolean {
  return plan.databaseBrowseRevision === revisions.databaseBrowseRevision &&
    plan.databaseAnnotationRevision === revisions.databaseAnnotationRevision && plan.rendererRevision === revisions.rendererRevision;
}
