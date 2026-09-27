import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { normalizeFileTags } from '../shared/fileTags';
import type { MetadataBackupExportResult, MetadataBackupSnapshot } from '../shared/backupContracts';
import {
  buildMetadataBackupV1,
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
  getPendingAnnotations?: () => MetadataBackupAnnotation[];
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

function readIndexedAnnotations(db: Database): MetadataBackupAnnotation[] {
  const readSnapshot = db.transaction(() => db.prepare(`
    SELECT path, tags, notes, print_status
    FROM files
    ORDER BY path COLLATE BINARY
  `).all() as IndexedAnnotationRow[]);
  return readSnapshot().map((row) => ({
    path: row.path,
    tags: row.tags ? parseTags(row.tags) : [],
    notes: row.notes,
    ...(row.print_status !== null ? { printStatus: row.print_status } : {}),
  }));
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

  async function exportMetadata(input: MetadataBackupSnapshot): Promise<MetadataBackupExportResult> {
    let snapshot: MetadataBackupSnapshot;
    try {
      // Normalize synchronously before snapshotting SQLite or opening a native dialog.
      snapshot = parseMetadataBackupSnapshot(input);
      if (!isCurrentRendererRevision(dependencies.getCurrentRendererRevision, snapshot.rendererRevision)) return invalidSnapshot();
    } catch (error) {
      return { status: 'failed', code: 'invalid-snapshot', message: error instanceof Error ? error.message : String(error) };
    }

    // This synchronous SQLite read transaction completes before any await.
    let indexedAnnotations: MetadataBackupAnnotation[];
    let pendingAnnotations: MetadataBackupAnnotation[];
    try {
      indexedAnnotations = readIndexedAnnotations(dependencies.db);
      pendingAnnotations = dependencies.getPendingAnnotations?.() ?? [];
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

    let document: ReturnType<typeof buildMetadataBackupV1>;
    let serialized: string;
    try {
      document = buildMetadataBackupV1({
        exportedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        appVersion: dependencies.appVersion,
        snapshot,
        indexedAnnotations,
        pendingAnnotations,
      });
      serialized = serializeMetadataBackup(document);
    } catch (error) {
      return { status: 'failed', code: 'write-failed', message: error instanceof Error ? error.message : String(error) };
    }

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
