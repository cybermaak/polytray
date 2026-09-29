import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { MetadataBackupSnapshot, MetadataImportPlan, MetadataImportRecoveryResult, MetadataImportCommitResult, StagedMetadataRestore } from '../shared/backupContracts';
import { buildMetadataBackupV1, canonicalizeBackupPath, parseMetadataBackupSnapshot, validateMetadataBackupV1, type MetadataBackupAnnotation } from '../shared/metadataBackup';
import { createMetadataImportPlan, isMetadataImportPlanCurrent } from '../shared/metadataImportPlan';
import { ARCHIVE_ENTRY_SEPARATOR } from '../shared/archivePaths';
import { normalizeFileTags, serializeFileTags } from '../shared/fileTags';
import { normalizeAppSettings } from '../shared/settings';
import { advanceLibraryRevisions, getBrowseRevision } from './libraryRevisions';
import { createMetadataRestoreJournal, type MetadataRestoreJournalRecord, type MetadataRestoreLocalState } from './metadataRestoreJournal';
import { createFileIndexRepository, subscribeToFileIndexMutations, type CommittedFileMutation, type FileIndexRepository } from './fileIndexing';

export interface MetadataRestoreJournal {
  write(record: MetadataRestoreJournalRecord): Promise<void>;
  readPending(): Promise<MetadataRestoreJournalRecord[]>;
  remove(transactionId: string): Promise<void>;
}
export interface MetadataRestoreDependencies {
  db: Database;
  repository?: FileIndexRepository;
  journal: MetadataRestoreJournal;
  recoveryDirectory: string;
  getRendererRevision: () => number;
  getRendererState: () => Omit<MetadataBackupSnapshot, 'rendererRevision'> & { preferences: Record<string, unknown> };
  /** Startup reconciliation and commit acknowledgment both use idempotent full-state writes. */
  applyRendererState: (state: StagedMetadataRestore) => Promise<void>;
  /** Coordinator-owned gate that queues renderer and index mutations until release. */
  acquireMutationLease: (transactionId: string) => Promise<() => void | Promise<void>>;
  /** Synchronous gate shared with mutations during the SQLite commit itself. */
  withCommitBoundary?: <T>(commit: () => T) => T;
  now?: () => Date;
  afterPreparedJournal?: () => void;
}

interface IndexedRow { id: number; path: string; tags: string | null; notes: string | null; print_status: string | null; content_revision?: number }
interface PendingRow { canonical_path: string; path: string; tags: string; notes: string | null; print_status: string | null; provenance: string }
interface StoredRestore { rendererState: StagedMetadataRestore; result: Record<string, unknown> }

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(tag => typeof tag !== 'string')) throw new Error('Stored annotation tags are corrupt');
  return normalizeFileTags(parsed);
}
function identityKey(value: string) {
  const canonical = canonicalizeBackupPath(value);
  const separator = canonical.indexOf(ARCHIVE_ENTRY_SEPARATOR);
  const physical = separator < 0 ? canonical : canonical.slice(0, separator);
  const windows = /^[A-Za-z]:[\\/]/.test(physical) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(physical);
  if (!windows) return canonical;
  const key = physical.toLowerCase().replace(/[\\/]+$/, '');
  const rooted = /^[a-z]:$/.test(key) ? `${key}\\` : key;
  return separator < 0 ? rooted : `${rooted}${ARCHIVE_ENTRY_SEPARATOR}${canonical.slice(separator + ARCHIVE_ENTRY_SEPARATOR.length)}`;
}
function annotationFromIndexed(row: IndexedRow): MetadataBackupAnnotation {
  return { path: row.path, tags: parseTags(row.tags), notes: row.notes, ...(row.print_status !== null ? { printStatus: row.print_status } : {}) };
}
function localState(state: { libraryRoots: string[]; collections: MetadataBackupSnapshot['collections']; preferences: Record<string, unknown> }): MetadataRestoreLocalState {
  return { roots: [...state.libraryRoots], collections: state.collections.map(collection => ({ ...collection, paths: [...collection.paths] })), settings: { ...state.preferences } };
}
function stagedState(transactionId: string, rendererRevision: number, state: MetadataRestoreLocalState, pendingAnnotations: MetadataBackupAnnotation[], conflicts: MetadataImportPlan['annotationConflicts'], recoveryBackupPath: string): StagedMetadataRestore {
  return {
    transactionId, rendererRevision, settings: { ...state.settings }, libraryRoots: [...state.roots],
    collections: state.collections.map(collection => ({ ...collection, paths: [...collection.paths] })),
    pendingAnnotations: pendingAnnotations.map(annotation => ({ ...annotation, tags: [...annotation.tags] })),
    annotationConflicts: conflicts.map(conflict => ({ ...conflict })), recoveryBackupPath,
  };
}
function atomicWrite(target: string, contents: string) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, target);
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch { /* retain the primary error */ }
    throw error;
  }
}
function parseStoredRestore(raw: string): StoredRestore {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('rendererState' in value)) throw new Error('Stored metadata restore state is corrupt');
  const stored = value as StoredRestore;
  if (!stored.rendererState || typeof stored.rendererState.transactionId !== 'string' || !Array.isArray(stored.rendererState.libraryRoots) ||
      !Array.isArray(stored.rendererState.collections) || !stored.rendererState.settings || !Array.isArray(stored.rendererState.pendingAnnotations)) {
    throw new Error('Stored metadata restore state is corrupt');
  }
  return stored;
}
function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableValue(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
function validateRecoveryBackup(raw: string, transactionId: string, expectedPath: string) {
  if (path.resolve(raw) !== path.resolve(expectedPath)) throw new Error('Recovery backup path does not match the restore transaction');
  const value: unknown = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const state = record?.rendererState && typeof record.rendererState === 'object' ? record.rendererState as Record<string, unknown> : null;
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 ||
      (value as { transactionId?: unknown }).transactionId !== transactionId ||
      typeof (value as { createdAt?: unknown }).createdAt !== 'string' ||
      !Array.isArray(record?.indexedAnnotations) || !Array.isArray(record?.pendingAnnotations) ||
      !state || !Array.isArray(state.roots) || !Array.isArray(state.collections) || !state.settings || typeof state.settings !== 'object') {
    throw new Error('Recovery backup is corrupt or incomplete');
  }
  return value;
}

export function createMetadataRestoreService(dependencies: MetadataRestoreDependencies) {
  const { db } = dependencies;
  const repository = dependencies.repository ?? createFileIndexRepository(db);
  const pendingSelect = db.prepare('SELECT canonical_path, path, tags, notes, print_status, provenance FROM pending_annotations ORDER BY canonical_path');
  const plans = new Map<string, MetadataImportPlan>();
  const commitOperations = new Map<string, Promise<MetadataImportCommitResult>>();
  const cancelOperations = new Map<string, Promise<void>>();
  const withBoundary = dependencies.withCommitBoundary ?? ((commit) => commit());
  const mutationLeases = new Map<string, () => void | Promise<void>>();
  let unresolvedFailure: string | null = null;

  async function acquireMutationLease(transactionId: string) {
    if (mutationLeases.has(transactionId)) return;
    const release = await dependencies.acquireMutationLease(transactionId);
    mutationLeases.set(transactionId, release);
  }
  async function releaseMutationLease(transactionId: string) {
    const release = mutationLeases.get(transactionId);
    if (!release) return;
    mutationLeases.delete(transactionId);
    await release();
  }

  function readPending() {
    return repository.getPendingAnnotations();
  }
  function readCurrentSnapshot(snapshot: MetadataBackupSnapshot) {
    const rows = db.prepare('SELECT id, path, tags, notes, print_status, content_revision FROM files ORDER BY path COLLATE BINARY').all() as IndexedRow[];
    const revision = getBrowseRevision(db);
    const rendererRevision = dependencies.getRendererRevision();
    if (!Number.isSafeInteger(rendererRevision) || rendererRevision !== snapshot.rendererRevision) throw new Error('Renderer state changed; regenerate the metadata import preview');
    return {
      databaseBrowseRevision: revision, rendererRevision,
      annotations: rows.map(annotationFromIndexed), pendingAnnotations: readPending(),
      indexedIdentities: rows.map(row => ({ id: row.id, path: row.path, contentRevision: row.content_revision! })),
      rendererState: { libraryRoots: snapshot.libraryRoots, collections: snapshot.collections, preferences: snapshot.preferences },
    };
  }
  function pendingAfterPlan(plan: MetadataImportPlan): MetadataBackupAnnotation[] {
    const next = new Map(readPending().map(row => [identityKey(row.path), row]));
    for (const update of plan.pendingAnnotationUpdates) if (update.changed) next.set(identityKey(update.path), update.after);
    return [...next.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  function createStaged(plan: MetadataImportPlan, rendererState: MetadataRestoreLocalState, pending: MetadataBackupAnnotation[], recoveryBackupPath: string) {
    return stagedState(plan.transactionId, plan.currentRendererRevision, rendererState, pending, plan.annotationConflicts, recoveryBackupPath);
  }
  function currentMarker(transactionId: string) { return repository.getMetadataImportTransaction(transactionId) ?? undefined; }
  function completedOrStored(transactionId: string): MetadataImportCommitResult | null {
    const marker = currentMarker(transactionId);
    if (!marker) return null;
    const stored = parseStoredRestore(marker.result);
    return { status: 'staged', rendererState: stored.rendererState };
  }
  function checkFresh(plan: MetadataImportPlan) {
    const fresh = { browseRevision: getBrowseRevision(db), rendererRevision: dependencies.getRendererRevision() };
    if (!isMetadataImportPlanCurrent(plan, fresh)) throw new Error('Metadata import preview is stale; regenerate it before applying');
  }

  function applyPendingForAddedPath(filePath: string): { applied: boolean; conflicted: boolean } | null {
    const key = identityKey(filePath);
    const pending = (pendingSelect.all() as PendingRow[]).find(row => row.canonical_path === key);
    if (!pending) return null;
    const file = db.prepare('SELECT id, path, tags, notes, print_status FROM files WHERE path = ?').get(filePath) as IndexedRow | undefined;
    if (!file || identityKey(file.path) !== key) return null;
    const rendererState = dependencies.getRendererState();
    const backup = buildMetadataBackupV1({
      exportedAt: (dependencies.now?.() ?? new Date()).toISOString(), appVersion: 'pending-restore',
      indexedAnnotations: [{ path: pending.path, tags: parseTags(pending.tags), notes: pending.notes, ...(pending.print_status !== null ? { printStatus: pending.print_status } : {}) }],
      pendingAnnotations: [],
      snapshot: { rendererRevision: dependencies.getRendererRevision(), libraryRoots: rendererState.libraryRoots,
        collections: rendererState.collections, preferences: rendererState.preferences as MetadataBackupSnapshot['preferences'] },
    });
    const plan = createMetadataImportPlan({ backup, current: {
      databaseBrowseRevision: getBrowseRevision(db), rendererRevision: dependencies.getRendererRevision(),
      annotations: (db.prepare('SELECT id, path, tags, notes, print_status FROM files ORDER BY path COLLATE BINARY').all() as IndexedRow[]).map(annotationFromIndexed),
      pendingAnnotations: readPending(), rendererState: { libraryRoots: rendererState.libraryRoots, collections: rendererState.collections, preferences: rendererState.preferences },
    } });
    const update = plan.annotationUpdates.find(value => identityKey(value.path) === key);
    if (!update) return null;
    const pathConflicts = plan.annotationConflicts.filter(conflict => identityKey(conflict.path) === key);
    const timestamp = Date.now();
    const result = db.transaction(() => {
      const actual = db.prepare('SELECT id, path FROM files WHERE path = ?').get(filePath) as { id: number; path: string } | undefined;
      if (!actual || actual.id !== file.id || identityKey(actual.path) !== key) return null;
      let annotationsChanged = false;
      if (update.changed) {
        const written = db.prepare('UPDATE files SET tags = ?, notes = ?, print_status = ? WHERE id = ? AND path = ?')
          .run(serializeFileTags(update.after.tags), update.after.notes, update.after.printStatus ?? null, actual.id, actual.path);
        annotationsChanged = written.changes === 1;
      }
      if (pathConflicts.length === 0) {
        db.prepare('DELETE FROM pending_annotations WHERE canonical_path = ?').run(key);
        db.prepare('DELETE FROM metadata_restore_conflicts WHERE canonical_path = ?').run(key);
      } else {
        db.prepare(`INSERT INTO metadata_restore_conflicts (canonical_path, path, conflicts, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(canonical_path) DO UPDATE SET path = excluded.path, conflicts = excluded.conflicts, updated_at = excluded.updated_at`)
          .run(key, filePath, JSON.stringify(pathConflicts), timestamp);
      }
      const pendingConsumed = pathConflicts.length === 0;
      const revisions = annotationsChanged || pendingConsumed ? advanceLibraryRevisions(db, { browse: true }) : { browseRevision: getBrowseRevision(db) };
      return { browseRevision: revisions.browseRevision, annotationsChanged, conflicts: pathConflicts, pendingConsumed };
    }).immediate();
    if (result && (result.annotationsChanged || result.pendingConsumed)) {
      repository.publishMetadataAnnotationMutation([filePath], result.browseRevision);
    }
    return result ? { applied: result.annotationsChanged || result.pendingConsumed, conflicted: result.conflicts.length > 0 } : null;
  }

  const mutationObserver = (mutation: CommittedFileMutation) => {
    for (const filePath of mutation.addedPaths ?? []) {
      try { applyPendingForAddedPath(filePath); }
      catch (error) { console.error('[MetadataRestore] Could not apply pending annotations for committed file:', filePath, error); }
    }
  };
  const unsubscribeFileIndexMutations = subscribeToFileIndexMutations(db, mutationObserver);

  function previewImport(input: unknown, rendererSnapshot: MetadataBackupSnapshot, options?: { replaceSettings?: boolean; replaceRoots?: boolean }) {
    const normalizedSnapshot = parseMetadataBackupSnapshot(rendererSnapshot);
    const fullSnapshot = { ...normalizedSnapshot, preferences: { ...(rendererSnapshot.preferences as Record<string, unknown>) } } as MetadataBackupSnapshot;
    const current = readCurrentSnapshot(fullSnapshot);
    const plan = createMetadataImportPlan({ backup: validateMetadataBackupV1(input), current, options });
    plans.set(plan.transactionId, plan);
    return plan;
  }

  function getCurrentSnapshot(): MetadataBackupSnapshot & { preferences: Record<string, unknown> } {
    const state = dependencies.getRendererState();
    return {
      rendererRevision: dependencies.getRendererRevision(),
      libraryRoots: [...state.libraryRoots],
      collections: state.collections.map(collection => ({ ...collection, paths: [...collection.paths] })),
      preferences: { ...state.preferences },
    };
  }

  async function performCommitImport(plan: MetadataImportPlan): Promise<MetadataImportCommitResult> {
    try {
      const previous = completedOrStored(plan.transactionId);
      if (previous) {
        if (currentMarker(plan.transactionId)?.state === 'complete') await releaseMutationLease(plan.transactionId);
        return previous;
      }
      await acquireMutationLease(plan.transactionId);
      checkFresh(plan);
      const currentRenderer = dependencies.getRendererState();
      const before = localState(currentRenderer);
      const after: MetadataRestoreLocalState = {
        roots: [...plan.rootsAfter], collections: plan.collectionsAfter.map(c => ({ ...c, paths: [...c.paths] })), settings: { ...plan.settingsAfter },
      };
      const recoveryBackupPath = path.join(dependencies.recoveryDirectory, `${plan.transactionId}.json`);
      const indexedBefore = db.prepare('SELECT id, path, tags, notes, print_status FROM files ORDER BY id').all();
      const pendingBefore = pendingSelect.all();
      atomicWrite(recoveryBackupPath, `${JSON.stringify({ version: 1, transactionId: plan.transactionId, createdAt: (dependencies.now?.() ?? new Date()).toISOString(), rendererState: before, indexedAnnotations: indexedBefore, pendingAnnotations: pendingBefore })}\n`);
      const staged = createStaged(plan, after, pendingAfterPlan(plan), recoveryBackupPath);
      const record: MetadataRestoreJournalRecord = {
        transactionId: plan.transactionId, state: 'prepared', createdAt: (dependencies.now?.() ?? new Date()).toISOString(),
        recoveryBackupPath, before, after, plan,
      };
      await dependencies.journal.write(record);
      dependencies.afterPreparedJournal?.();

      const committed = withBoundary(() => {
        checkFresh(plan);
        const result: StoredRestore = { rendererState: staged, result: { matchedAnnotationCount: plan.matchedAnnotationCount, changedAnnotationCount: plan.changedAnnotationCount, pendingAnnotationCount: plan.pendingAnnotationCount } };
        return repository.applyMetadataRestoreTransaction({ plan, rendererState: staged, recoveryBackupPath, createdAt: record.createdAt, result });
      });
      await dependencies.journal.write({ ...record, state: 'database-applied' });
      const stored = parseStoredRestore((currentMarker(plan.transactionId)!).result);
      if (committed !== getBrowseRevision(db) || stored.rendererState.transactionId !== plan.transactionId) throw new Error('Restore transaction state did not commit consistently');
      return { status: 'staged', rendererState: stored.rendererState };
    } catch (error) {
      if (!currentMarker(plan.transactionId)) await releaseMutationLease(plan.transactionId).catch(() => undefined);
      unresolvedFailure = error instanceof Error ? error.message : String(error);
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async function commitImport(input: string | MetadataImportPlan): Promise<MetadataImportCommitResult> {
    const transactionId = typeof input === 'string' ? input : input.transactionId;
    const cancelling = cancelOperations.get(transactionId);
    if (cancelling) {
      try { await cancelling; }
      catch (error) {
        const committed = completedOrStored(transactionId);
        if (committed) return committed;
        return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
      }
    }
    const existing = commitOperations.get(transactionId);
    if (existing) return existing;
    const plan = plans.get(transactionId);
    if (!plan || typeof input !== 'string' && JSON.stringify(plan) !== JSON.stringify(input)) {
      return { status: 'failed', message: 'Metadata import plan was not prepared by this service; regenerate the preview' };
    }
    let tracked!: Promise<MetadataImportCommitResult>;
    tracked = performCommitImport(plan).finally(() => {
      if (commitOperations.get(transactionId) === tracked) commitOperations.delete(transactionId);
    });
    commitOperations.set(transactionId, tracked);
    return tracked;
  }

  async function acknowledgeImport(transactionId: string, rendererRevision: number) {
    const marker = currentMarker(transactionId);
    if (!marker) throw new Error('Metadata restore has not committed to SQLite');
    if (marker.state === 'complete') return;
    const stored = parseStoredRestore(marker.result);
    if (rendererRevision !== stored.rendererState.rendererRevision) throw new Error('Renderer acknowledgment revision does not match the staged restore');
    const actualRendererState = dependencies.getRendererState();
    const normalizedSnapshot = parseMetadataBackupSnapshot({
      rendererRevision,
      libraryRoots: actualRendererState.libraryRoots,
      collections: actualRendererState.collections,
      preferences: actualRendererState.preferences,
    });
    const actualSettings = { ...actualRendererState.preferences, ...normalizeAppSettings(actualRendererState.preferences) };
    const actualState = {
      roots: normalizedSnapshot.libraryRoots,
      collections: normalizedSnapshot.collections,
      settings: actualSettings,
    };
    const expectedState = {
      roots: stored.rendererState.libraryRoots,
      collections: stored.rendererState.collections,
      settings: stored.rendererState.settings,
    };
    if (stableValue(actualState) !== stableValue(expectedState)) throw new Error('Renderer state does not match the staged metadata restore');
    const timestamp = (dependencies.now?.() ?? new Date()).toISOString();
    repository.updateMetadataImportTransactionState(transactionId, 'renderer-applied', timestamp);
    const journalRecord = await dependencies.journal.readPending().then(records => records.find(record => record.transactionId === transactionId));
    if (journalRecord) await dependencies.journal.write({ ...journalRecord, state: 'renderer-applied' });
    repository.updateMetadataImportTransactionState(transactionId, 'complete', timestamp);
    if (journalRecord) await dependencies.journal.write({ ...journalRecord, state: 'complete' });
    await releaseMutationLease(transactionId);
  }

  async function reconcileImport(): Promise<MetadataImportRecoveryResult> {
    let records: MetadataRestoreJournalRecord[];
    try { records = await dependencies.journal.readPending(); }
    catch (error) { return { status: 'blocked', transactionId: null, message: error instanceof Error ? error.message : String(error) }; }
    for (const record of records) {
      const marker = currentMarker(record.transactionId);
      if (!marker) {
        try {
          validateRecoveryBackup(record.recoveryBackupPath, record.transactionId, path.join(dependencies.recoveryDirectory, `${record.transactionId}.json`));
          await dependencies.journal.remove(record.transactionId);
          await fs.promises.unlink(record.recoveryBackupPath).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          });
        }
        catch (error) { return { status: 'blocked', transactionId: record.transactionId, message: `Could not abort prepared restore: ${error instanceof Error ? error.message : String(error)}` }; }
        await releaseMutationLease(record.transactionId);
        continue;
      }
      if (marker.state === 'complete') {
        try { await dependencies.journal.write({ ...record, state: 'complete' }); }
        catch (error) { return { status: 'blocked', transactionId: record.transactionId, message: `Could not finish restore journal: ${error instanceof Error ? error.message : String(error)}` }; }
        await releaseMutationLease(record.transactionId);
      }
    }
    const committed = repository.listIncompleteMetadataImportTransactions();
    const completedIds = db.prepare(`SELECT transaction_id FROM metadata_import_transactions WHERE state = 'complete'`).all() as Array<{ transaction_id: string }>;
    for (const row of completedIds) await releaseMutationLease(row.transaction_id);
    let recoveredState: StagedMetadataRestore | null = null;
    for (const marker of committed) {
      try {
        await acquireMutationLease(marker.transaction_id);
        validateRecoveryBackup(marker.recovery_backup_path, marker.transaction_id, path.join(dependencies.recoveryDirectory, `${marker.transaction_id}.json`));
        const stored = parseStoredRestore(marker.result);
        await dependencies.applyRendererState(stored.rendererState);
        await acknowledgeImport(marker.transaction_id, stored.rendererState.rendererRevision);
        recoveredState = stored.rendererState;
      } catch (error) {
        return { status: 'blocked', transactionId: marker.transaction_id, message: `Restore recovery requires attention; recovery backup retained at ${marker.recovery_backup_path}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    const committedIds = new Set((db.prepare('SELECT transaction_id FROM metadata_import_transactions').all() as Array<{ transaction_id: string }>).map(row => row.transaction_id));
    let backupNames: string[];
    try { backupNames = await fs.promises.readdir(dependencies.recoveryDirectory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') backupNames = [];
      else return { status: 'blocked', transactionId: null, message: `Recovery backup directory is unreadable: ${error instanceof Error ? error.message : String(error)}` };
    }
    for (const name of backupNames.filter(value => value.endsWith('.json'))) {
      const file = path.join(dependencies.recoveryDirectory, name);
      let backupValue: unknown;
      try { backupValue = validateRecoveryBackup(file, path.basename(name, '.json'), file); }
      catch (error) { return { status: 'blocked', transactionId: path.basename(name, '.json'), message: `Recovery backup is corrupt; evidence retained at ${file}: ${error instanceof Error ? error.message : String(error)}` }; }
      const transactionId = path.basename(name, '.json');
      if (!committedIds.has(transactionId)) {
        try { await fs.promises.unlink(file); }
        catch (error) { return { status: 'blocked', transactionId, message: `Could not discard aborted recovery backup at ${file}: ${error instanceof Error ? error.message : String(error)}` }; }
      }
    }
    unresolvedFailure = null;
    if (recoveredState) return { status: 'roll-forward', rendererState: recoveredState };
    return { status: 'none' };
  }

  function retryPendingAnnotations() {
    const rows = db.prepare('SELECT path FROM pending_annotations ORDER BY canonical_path').all() as Array<{ path: string }>;
    const indexed = db.prepare('SELECT path FROM files ORDER BY path').all() as Array<{ path: string }>;
    const indexedByKey = new Map(indexed.map(row => [identityKey(row.path), row.path]));
    let appliedCount = 0;
    let conflictCount = 0;
    for (const row of rows) {
      const actualPath = indexedByKey.get(identityKey(row.path));
      if (!actualPath) continue;
      const result = applyPendingForAddedPath(actualPath);
      if (result?.applied) appliedCount++;
      if (result?.conflicted) conflictCount++;
    }
    return { appliedCount, conflictCount };
  }

  async function getStatus() {
    let journalRecords: MetadataRestoreJournalRecord[] = [];
    let journalError: string | null = null;
    try { journalRecords = await dependencies.journal.readPending(); }
    catch (error) { journalError = error instanceof Error ? error.message : String(error); }
    const allMarkerRows = db.prepare(`SELECT transaction_id, state, recovery_backup_path FROM metadata_import_transactions ORDER BY created_at`).all() as Array<{
      transaction_id: string; state: string; recovery_backup_path: string;
    }>;
    for (const row of allMarkerRows) {
      try { validateRecoveryBackup(row.recovery_backup_path, row.transaction_id, path.join(dependencies.recoveryDirectory, `${row.transaction_id}.json`)); }
      catch (error) { journalError ??= `Recovery backup needs attention at ${row.recovery_backup_path}: ${error instanceof Error ? error.message : String(error)}`; }
    }
    const markerRows = allMarkerRows.filter(row => row.state !== 'complete');
    const transactionsById = new Map<string, { transactionId: string; state: string; recoveryBackupPath: string }>();
    for (const row of markerRows) transactionsById.set(row.transaction_id, { transactionId: row.transaction_id, state: row.state, recoveryBackupPath: row.recovery_backup_path });
    for (const record of journalRecords) {
      transactionsById.set(record.transactionId, { transactionId: record.transactionId, state: record.state, recoveryBackupPath: record.recoveryBackupPath });
    }
    try {
      const backupNames = await fs.promises.readdir(dependencies.recoveryDirectory);
      const known = new Set(allMarkerRows.map(row => row.transaction_id));
      for (const name of backupNames.filter(value => value.endsWith('.json'))) {
        const transactionId = path.basename(name, '.json');
        if (!known.has(transactionId)) transactionsById.set(transactionId, { transactionId, state: 'prepared', recoveryBackupPath: path.join(dependencies.recoveryDirectory, name) });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') journalError ??= `Recovery backup directory is unreadable: ${error instanceof Error ? error.message : String(error)}`;
    }
    const conflicts = db.prepare('SELECT path, conflicts FROM metadata_restore_conflicts ORDER BY canonical_path').all() as Array<{ path: string; conflicts: string }>;
    return {
      unresolved: journalError !== null || unresolvedFailure !== null || transactionsById.size > 0,
      error: journalError ?? unresolvedFailure,
      pendingAnnotationCount: (db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count,
      conflicts: conflicts.map(row => ({ path: row.path, conflicts: JSON.parse(row.conflicts) as MetadataImportPlan['annotationConflicts'] })),
      transactions: [...transactionsById.values()],
    };
  }

  async function performCancelImport(transactionId: string) {
    const committing = commitOperations.get(transactionId);
    if (committing) await committing;
    if (currentMarker(transactionId)) throw new Error('A committed restore cannot be canceled; reconcile it forward');
    const record = (await dependencies.journal.readPending()).find(value => value.transactionId === transactionId);
    if (record) {
      await dependencies.journal.remove(transactionId);
      await fs.promises.unlink(record.recoveryBackupPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
    await releaseMutationLease(transactionId);
    unresolvedFailure = null;
    plans.delete(transactionId);
  }

  async function cancelImport(transactionId: string) {
    const existing = cancelOperations.get(transactionId);
    if (existing) return existing;
    let tracked!: Promise<void>;
    tracked = performCancelImport(transactionId).finally(() => {
      if (cancelOperations.get(transactionId) === tracked) cancelOperations.delete(transactionId);
    });
    cancelOperations.set(transactionId, tracked);
    return tracked;
  }

  return { getCurrentSnapshot, previewImport, commitImport, acknowledgeImport, reconcileImport, cancelImport, getStatus, retryPendingAnnotations, dispose: unsubscribeFileIndexMutations };
}
