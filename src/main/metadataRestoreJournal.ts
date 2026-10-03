import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MetadataImportPlan } from '../shared/backupContracts';
import { syncDirectoryAsync } from './directorySync';

export type MetadataRestoreJournalState = 'prepared' | 'database-applied' | 'renderer-applied' | 'complete';
export interface MetadataRestoreLocalState {
  roots: string[];
  collections: Array<{ id: string; name: string; paths: string[] }>;
  settings: Record<string, unknown>;
}
export interface MetadataRestoreJournalRecord {
  transactionId: string;
  state: MetadataRestoreJournalState;
  createdAt: string;
  recoveryBackupPath: string;
  before: MetadataRestoreLocalState;
  after: MetadataRestoreLocalState;
  plan: MetadataImportPlan;
}

function safeTransactionId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid restore transaction ID');
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
function isLocalState(value: unknown): value is MetadataRestoreLocalState {
  if (!isObject(value) || !isStringArray(value.roots) || !Array.isArray(value.collections) || !isObject(value.settings)) return false;
  return value.collections.every(collection => isObject(collection) && typeof collection.id === 'string' &&
    typeof collection.name === 'string' && isStringArray(collection.paths));
}
function isAnnotation(value: unknown): boolean {
  return isObject(value) && typeof value.path === 'string' && Array.isArray(value.tags) &&
    value.tags.every(tag => typeof tag === 'string') && (typeof value.notes === 'string' || value.notes === null) &&
    (value.printStatus === undefined || typeof value.printStatus === 'string');
}
function isPlan(value: unknown, transactionId: string): value is MetadataImportPlan {
  if (!isObject(value) || value.transactionId !== transactionId || typeof value.inputRevision !== 'string' ||
    !Number.isSafeInteger(value.currentBrowseRevision) || !Number.isSafeInteger(value.currentRendererRevision) ||
    !['matchedAnnotationCount', 'changedAnnotationCount', 'pendingAnnotationCount', 'conflictCount'].every(key => Number.isSafeInteger(value[key])) ||
    !isStringArray(value.unmatchedPaths) || !Array.isArray(value.indexedIdentityExpectations) ||
    !Array.isArray(value.annotationUpdates) || !Array.isArray(value.pendingAnnotationUpdates) ||
    !Array.isArray(value.changedAnnotationUpdates) || !Array.isArray(value.unchangedAnnotationUpdates) ||
    !Array.isArray(value.annotationConflicts) || !Array.isArray(value.collectionIdRemaps) ||
    !Array.isArray(value.collectionsBefore) || !Array.isArray(value.collectionsAfter) ||
    !isObject(value.settingsBefore) || !isObject(value.settingsAfter) || !isStringArray(value.rootsBefore) || !isStringArray(value.rootsAfter) ||
    typeof value.replaceSettings !== 'boolean' || typeof value.replaceRoots !== 'boolean') return false;
  const updates = [...value.annotationUpdates, ...value.pendingAnnotationUpdates, ...value.changedAnnotationUpdates, ...value.unchangedAnnotationUpdates];
  if (!updates.every(update => isObject(update) && typeof update.path === 'string' &&
    (update.destination === 'indexed' || update.destination === 'pending') &&
    (update.before === null || isAnnotation(update.before)) && isAnnotation(update.after) &&
    Array.isArray(update.sources) && update.sources.every(source => source === 'annotations' || source === 'pendingAnnotations') &&
    typeof update.changed === 'boolean')) return false;
  if (!value.indexedIdentityExpectations.every(identity => isObject(identity) && Number.isSafeInteger(identity.id) &&
    typeof identity.path === 'string' && Number.isSafeInteger(identity.contentRevision))) return false;
  return true;
}

function parseRecord(value: unknown): MetadataRestoreJournalRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid metadata restore journal record');
  const record = value as Partial<MetadataRestoreJournalRecord>;
  if (typeof record.transactionId !== 'string' || !record.transactionId ||
    !['prepared', 'database-applied', 'renderer-applied', 'complete'].includes(String(record.state)) ||
    typeof record.createdAt !== 'string' || typeof record.recoveryBackupPath !== 'string' ||
    !isLocalState(record.before) || !isLocalState(record.after) || !isPlan(record.plan, record.transactionId)) {
    throw new Error('Invalid metadata restore journal record');
  }
  safeTransactionId(record.transactionId);
  return record as MetadataRestoreJournalRecord;
}

const TRANSIENT_WINDOWS_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Replace `target` with `source`. On Windows, renaming over a file fails with EPERM/EBUSY/EACCES
 * while any other handle has the target open (a concurrent status read of the same journal
 * record, antivirus or the indexer), so retry those briefly before giving up. Other platforms and
 * other errors fail immediately.
 */
export async function renameReplacing(
  source: string,
  target: string,
  options: {
    platform?: NodeJS.Platform;
    rename?: (from: string, to: string) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
    maxAttempts?: number;
  } = {},
) {
  const rename = options.rename ?? fs.promises.rename;
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 10;
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if ((options.platform ?? process.platform) !== 'win32' || !TRANSIENT_WINDOWS_RENAME_CODES.has(code) || attempt >= maxAttempts) throw error;
      await wait(Math.min(50 * attempt, 250));
    }
  }
}

async function writeAtomic(target: string, value: string) {
  const directory = path.dirname(target);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600);
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameReplacing(temporary, target);
    await syncDirectoryAsync(directory);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.promises.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function createMetadataRestoreJournal(directory: string) {
  const filePath = (transactionId: string) => path.join(directory, `${safeTransactionId(transactionId)}.json`);
  async function readFile(file: string): Promise<MetadataRestoreJournalRecord> {
    try { return parseRecord(JSON.parse(await fs.promises.readFile(file, 'utf8'))); }
    catch (error) { throw new Error(`Metadata restore journal is corrupt or unreadable (${path.basename(file)}): ${error instanceof Error ? error.message : String(error)}`); }
  }
  return {
    async write(record: MetadataRestoreJournalRecord) {
      const validated = parseRecord(record);
      await writeAtomic(filePath(validated.transactionId), `${JSON.stringify(validated)}\n`);
    },
    async read(transactionId: string) { return readFile(filePath(transactionId)); },
    async readPending() {
      let entries: string[];
      try { entries = await fs.promises.readdir(directory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw new Error(`Metadata restore journal is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }
      const records: MetadataRestoreJournalRecord[] = [];
      for (const name of entries.filter(entry => entry.endsWith('.json')).sort()) {
        const record = await readFile(path.join(directory, name));
        if (record.state !== 'complete') records.push(record);
      }
      return records;
    },
    async remove(transactionId: string) { await fs.promises.unlink(filePath(transactionId)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }); },
  };
}
