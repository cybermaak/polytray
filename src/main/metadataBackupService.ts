import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { normalizeFileTags } from '../shared/fileTags';
import type { MetadataBackupExportResult } from '../shared/backupContracts';
import {
  buildMetadataBackupV1,
  buildMetadataBackupV1FromNormalizedSnapshot,
  parseMetadataBackupSnapshot,
  serializeMetadataBackup,
  type MetadataBackupAnnotation,
} from '../shared/metadataBackup';

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

type AtomicWriteResult = 'written' | 'stale';

export interface MetadataBackupDependencies {
  db: Database;
  showSaveDialog: () => Promise<SaveDialogResult>;
  getCurrentRendererRevision: () => number;
  appVersion: string;
  getPendingAnnotations?: (db: Database) => MetadataBackupAnnotation[];
  now?: () => Date;
  writeAtomically?: (
    targetPath: string,
    contents: string,
    isRendererRevisionCurrent: () => boolean,
  ) => Promise<AtomicWriteResult>;
}

interface IndexedAnnotationRow {
  path: string;
  tags: string | null;
  notes: string | null;
  print_status: string | null;
}

async function writeAtomically(
  targetPath: string,
  contents: string,
  isRendererRevisionCurrent: () => boolean,
): Promise<AtomicWriteResult> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
  );
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!isRendererRevisionCurrent()) {
      await fs.promises.unlink(temporaryPath);
      return 'stale';
    }
    await fs.promises.rename(temporaryPath, targetPath);
    return 'written';
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function readAnnotationSnapshot(
  db: Database,
  getPendingAnnotations?: (db: Database) => MetadataBackupAnnotation[],
) {
  const readSnapshot = db.transaction(() => {
    const rows = db.prepare(`
    SELECT path, tags, notes, print_status
    FROM files
    ORDER BY path COLLATE BINARY
    `).all() as IndexedAnnotationRow[];
    const pending = getPendingAnnotations?.(db) ?? [];
    const indexedAnnotations = rows.map((row) => ({
      path: row.path,
      tags: row.tags ? parseTags(row.tags) : [],
      notes: row.notes,
      ...(row.print_status !== null ? { printStatus: row.print_status } : {}),
    }));
    return { indexedAnnotations, pendingAnnotations: pending };
  });
  return readSnapshot();
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== 'string')) {
      throw new Error('Invalid stored tag list');
    }
    return normalizeFileTags(parsed);
  } catch {
    throw new Error('Could not read indexed tags for metadata backup');
  }
}

function invalidSnapshot(): MetadataBackupExportResult {
  return {
    status: 'failed',
    code: 'invalid-snapshot',
    message: 'Renderer state changed during export preparation',
  };
}

function isCurrentRendererRevision(
  getCurrentRendererRevision: () => number,
  expectedRevision: number,
) {
  try {
    return getCurrentRendererRevision() === expectedRevision;
  } catch {
    return false;
  }
}

export function createMetadataBackupService(dependencies: MetadataBackupDependencies) {
  const write = dependencies.writeAtomically ?? writeAtomically;

  async function exportMetadata(input: unknown): Promise<MetadataBackupExportResult> {
    let snapshot: ReturnType<typeof parseMetadataBackupSnapshot>;
    try {
      // Normalize synchronously before snapshotting SQLite or opening a native dialog.
      snapshot = parseMetadataBackupSnapshot(input);
      if (!isCurrentRendererRevision(dependencies.getCurrentRendererRevision, snapshot.rendererRevision)) return invalidSnapshot();
    } catch (error) {
      return { status: 'failed', code: 'invalid-snapshot', message: error instanceof Error ? error.message : String(error) };
    }

    // Snapshot and normalize both sources synchronously before any await. The
    // pending provider receives this DB connection so DB-backed pending rows
    // share the indexed annotation read transaction.
    let document: ReturnType<typeof buildMetadataBackupV1>;
    let serialized: string;
    try {
      const annotations = readAnnotationSnapshot(dependencies.db, dependencies.getPendingAnnotations);
      document = buildMetadataBackupV1FromNormalizedSnapshot({
        exportedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        appVersion: dependencies.appVersion,
        snapshot,
        ...annotations,
      });
      serialized = serializeMetadataBackup(document);
    } catch (error) {
      return { status: 'failed', code: 'write-failed', message: error instanceof Error ? error.message : String(error) };
    }

    let selection: SaveDialogResult;
    try {
      selection = await dependencies.showSaveDialog();
    } catch (error) {
      return { status: 'failed', code: 'write-failed', message: error instanceof Error ? error.message : String(error) };
    }
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
    if (!isCurrentRendererRevision(dependencies.getCurrentRendererRevision, snapshot.rendererRevision)) return invalidSnapshot();

    const stillCurrent = () => isCurrentRendererRevision(dependencies.getCurrentRendererRevision, snapshot.rendererRevision);
    try {
      const writeResult = await write(selection.filePath, serialized, stillCurrent);
      if (writeResult === 'stale') return invalidSnapshot();
    } catch (error) {
      return { status: 'failed', code: 'write-failed', message: error instanceof Error ? error.message : String(error) };
    }

    return {
      status: 'exported',
      location: selection.filePath,
      annotationCount: document.annotations.length,
      collectionCount: document.collections.length,
      pendingAnnotationCount: document.pendingAnnotations.length,
    };
  }

  return { exportMetadata };
}
