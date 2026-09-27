import type { Database } from 'better-sqlite3';
import type { FileRecord, ModelDimensions } from '../shared/types';
import type {
  IndexBatch,
  IndexBatchResult,
  IndexMutationResult,
  MetadataEnrichmentResult,
  MetadataEnrichmentUpdate,
  PruneCandidate,
  RevisionGuardedMetadataResult,
  RevisionGuardedMetadataUpdate,
  WatchUpdate,
} from '../shared/libraryQuery';
import { parseArchiveEntryPath } from '../shared/archivePaths';
import { isPathContained } from './pathContainment';
import { enumerateFileScopes } from './fileScopes';
import { advanceLibraryRevisions, allocateContentRevision, getBrowseRevision } from './libraryRevisions';

export interface IndexedFileRecord {
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  modifiedAt: number;
  vertexCount: number;
  faceCount: number;
  dimensions: ModelDimensions | null;
  thumbnailPath: string | null;
  thumbnailFailed: number;
  indexedAt: number;
}

interface BaseFileInput {
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  vertexCount: number;
  faceCount: number;
  dimensions: ModelDimensions | null;
  indexedAt: number;
}

export interface ScannedFileRecord extends BaseFileInput {
  mtime: number;
}

export interface WatchedFileRecord extends BaseFileInput {
  modifiedAt: number;
  thumbnailPath: string | null;
  thumbnailFailed: number;
}

const FILES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    extension TEXT NOT NULL,
    directory TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    vertex_count INTEGER DEFAULT 0,
    face_count INTEGER DEFAULT 0,
    dimensions TEXT,
    thumbnail TEXT,
    thumbnail_failed INTEGER DEFAULT 0,
    indexed_at INTEGER NOT NULL
  );
`;

function toIndexedFileRecord(file: ScannedFileRecord): IndexedFileRecord {
  return {
    path: file.path,
    name: file.name,
    ext: file.ext,
    dir: file.dir,
    size: file.size,
    modifiedAt: file.mtime,
    vertexCount: file.vertexCount,
    faceCount: file.faceCount,
    dimensions: file.dimensions,
    thumbnailPath: null,
    thumbnailFailed: 0,
    indexedAt: file.indexedAt,
  };
}

function toWatchedIndexedFileRecord(file: WatchedFileRecord): IndexedFileRecord {
  return {
    path: file.path,
    name: file.name,
    ext: file.ext,
    dir: file.dir,
    size: file.size,
    modifiedAt: file.modifiedAt,
    vertexCount: file.vertexCount,
    faceCount: file.faceCount,
    dimensions: file.dimensions,
    thumbnailPath: file.thumbnailPath,
    thumbnailFailed: file.thumbnailFailed,
    indexedAt: file.indexedAt,
  };
}

export function mergeScannedFileRecord(
  existing: IndexedFileRecord | null,
  incoming: ScannedFileRecord,
): IndexedFileRecord {
  const next = toIndexedFileRecord(incoming);
  if (!existing) {
    return next;
  }

  if (incoming.mtime < existing.modifiedAt) {
    return existing;
  }

  if (incoming.mtime === existing.modifiedAt) {
    if (incoming.size !== existing.size) {
      return next;
    }
    return {
      ...existing,
      name: next.name,
      ext: next.ext,
      dir: next.dir,
      size: next.size,
      vertexCount: next.vertexCount,
      faceCount: next.faceCount,
      dimensions: next.dimensions,
      indexedAt: Math.max(existing.indexedAt, next.indexedAt),
    };
  }

  return next;
}

export function mergeWatchedFileRecord(
  existing: IndexedFileRecord | null,
  incoming: WatchedFileRecord,
): IndexedFileRecord {
  const next = toWatchedIndexedFileRecord(incoming);
  if (!existing) {
    return next;
  }

  if (incoming.modifiedAt < existing.modifiedAt) {
    return existing;
  }

  return next;
}

export function createFilesTableForTests(db: Database) {
  db.exec(FILES_TABLE_SQL);
}

export function applyScannedFileRecord(db: Database, file: ScannedFileRecord) {
  getLegacyRepository(db).applyLegacyScan(file);
}

export function applyWatchedFileRecord(db: Database, file: WatchedFileRecord) {
  getLegacyRepository(db).applyLegacyWatch(file);
}

export interface RevisionedFileRecord extends FileRecord {
  content_revision: number;
  archive_path: string | null;
}

export interface CommittedFileMutation extends IndexMutationResult {
  paths: string[];
}

export interface FileIndexRepository {
  applyIndexBatch(input: IndexBatch): IndexBatchResult;
  applyWatchUpdate(input: WatchUpdate): IndexMutationResult;
  deleteContainedFiles(rootPath: string, candidates: PruneCandidate[]): IndexMutationResult;
  applyMetadataResult(input: MetadataEnrichmentUpdate): MetadataEnrichmentResult;
  updateFileMetadata(input: RevisionGuardedMetadataUpdate): RevisionGuardedMetadataResult;
  updateThumbnailState(input: ThumbnailStateUpdate): ThumbnailStateUpdateResult;
  getBrowseRevision(): number;
  getFileContentRevision(fileId: number): number | null;
  applyLegacyScan(file: ScannedFileRecord): void;
  applyLegacyWatch(file: WatchedFileRecord): void;
}

export interface ThumbnailStateUpdate {
  fileId: number;
  expectedContentRevision: number;
  thumbnailPath: string | null;
  thumbnailFailed: number;
}

export type ThumbnailStateUpdateResult =
  | { status: 'updated'; contentRevision: number }
  | { status: 'stale'; currentContentRevision: number }
  | { status: 'missing' };

/** Prepared repository for all indexed-file writes. Notifications run after the transaction commits. */
export function createFileIndexRepository(
  db: Database,
  onMutation?: (mutation: CommittedFileMutation) => void,
): FileIndexRepository {
  const insertFile = db.prepare(`INSERT INTO files (
    path, name, extension, directory, size_bytes, modified_at, vertex_count, face_count,
    dimensions, thumbnail, thumbnail_failed, indexed_at, content_revision, archive_path, scan_generation
  ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, ?, ?, ?)`);
  const updateFile = db.prepare(`UPDATE files SET
    name = ?, extension = ?, directory = ?, size_bytes = ?, modified_at = ?,
    vertex_count = ?, face_count = ?, dimensions = ?, thumbnail = ?, thumbnail_failed = ?,
    indexed_at = ?, content_revision = ?, archive_path = ?, scan_generation = ?
    WHERE id = ?`);
  const updateUnchangedScan = db.prepare(`UPDATE files SET
    name = ?, extension = ?, directory = ?, indexed_at = ?, scan_generation = ? WHERE id = ?`);
  const updateFilePreservingGeneration = db.prepare(`UPDATE files SET
    name = ?, extension = ?, directory = ?, size_bytes = ?, modified_at = ?,
    vertex_count = ?, face_count = ?, dimensions = ?, thumbnail = ?, thumbnail_failed = ?,
    indexed_at = ?, content_revision = ?, archive_path = ? WHERE id = ?`);
  const updateUnchangedPreservingGeneration = db.prepare(`UPDATE files SET
    name = ?, extension = ?, directory = ?, indexed_at = ? WHERE id = ?`);
  const deleteScopes = db.prepare('DELETE FROM file_scopes WHERE file_id = ?');
  const insertScope = db.prepare('INSERT OR IGNORE INTO file_scopes (file_id, scope_path) VALUES (?, ?)');
  const insertScopesForPath = (fileId: number, filePath: string) => {
    deleteScopes.run(fileId);
    for (const scope of enumerateFileScopes(filePath)) insertScope.run(fileId, scope);
  };
  const findByIdAndRevision = db.prepare('SELECT * FROM files WHERE id = ? AND content_revision = ?');
  const removeScopesById = db.prepare('DELETE FROM file_scopes WHERE file_id = ?');
  const deleteById = db.prepare('DELETE FROM files WHERE id = ?');
  const updateEnrichment = db.prepare(`UPDATE files SET vertex_count = ?, face_count = ?, dimensions = ?
    WHERE id = ? AND path = ? AND content_revision = ?`);
  const updateAnnotations = db.prepare(`UPDATE files SET tags = ?, notes = ?
    WHERE id = ? AND content_revision = ?`);
  const findByPath = db.prepare('SELECT * FROM files WHERE path = ?');
  const findCurrentRevision = db.prepare('SELECT content_revision FROM files WHERE id = ?');
  const findFileById = db.prepare('SELECT * FROM files WHERE id = ?');
  const findCandidateRows = db.prepare(`SELECT id, path, content_revision, scan_generation FROM files
    WHERE path IN (${Array.from({ length: 250 }, () => '?').join(',')})`);
  const findContentRevision = db.prepare('SELECT content_revision FROM files WHERE id = ?');
  const findThumbnailState = db.prepare(`SELECT path, thumbnail, thumbnail_failed
    FROM files WHERE id = ? AND content_revision = ?`);
  const writeThumbnailState = db.prepare(`UPDATE files SET thumbnail = ?, thumbnail_failed = ?
    WHERE id = ? AND content_revision = ?`);
  const batchSize = 250;
  const findBatch = db.prepare(`SELECT * FROM files WHERE path IN (${Array.from({ length: batchSize }, () => '?').join(',')})`);

  function notify(result: IndexMutationResult, paths: string[]) {
    if (paths.length > 0) onMutation?.({ ...result, paths: [...new Set(paths)] });
  }

  function makeMutation(paths: string[], flags: { rows?: boolean; annotations?: boolean; stats?: boolean; topology?: boolean; thumbnailOnly?: boolean }): IndexMutationResult {
    const revisions = advanceLibraryRevisions(db, {
      browse: Boolean(flags.rows || flags.annotations),
      stats: Boolean(flags.stats),
      topology: Boolean(flags.topology),
    });
    return {
      affectedPaths: [...new Set(paths)],
      rowsChanged: Boolean(flags.rows),
      annotationsChanged: Boolean(flags.annotations),
      statsChanged: Boolean(flags.stats),
      topologyChanged: Boolean(flags.topology),
      thumbnailOnly: Boolean(flags.thumbnailOnly),
      browseRevision: revisions.browseRevision,
    };
  }

  function commitWatchAddOrChange(
    input: Extract<WatchUpdate, { kind: 'add' | 'change' }>,
    enrichment?: Pick<WatchedFileRecord, 'vertexCount' | 'faceCount' | 'dimensions' | 'thumbnailPath' | 'thumbnailFailed'>,
  ): IndexMutationResult {
    const result = db.transaction(() => {
      const existing = findByPath.get(input.path) as (RevisionedFileRecord & {
        size_bytes: number; modified_at: number;
      }) | undefined;
      const archivePath = parseArchiveEntryPath(input.path)?.archivePath ?? null;
      if (!existing) {
        const contentRevision = allocateContentRevision(db);
        const inserted = insertFile.run(input.path, input.name, input.extension, input.directory,
          input.sizeBytes, input.modifiedAt, Date.now(), contentRevision, archivePath, 0);
        const id = Number(inserted.lastInsertRowid);
        insertScopesForPath(id, input.path);
        if (enrichment) {
          updateEnrichment.run(enrichment.vertexCount, enrichment.faceCount,
            enrichment.dimensions ? JSON.stringify(enrichment.dimensions) : null,
            id, input.path, contentRevision);
          writeThumbnailState.run(enrichment.thumbnailPath, enrichment.thumbnailFailed, id, contentRevision);
        }
        return makeMutation([input.path], { rows: true, stats: true, topology: true });
      }

      if (input.expectedContentRevision !== undefined && input.expectedContentRevision !== existing.content_revision) {
        return { affectedPaths: [], rowsChanged: false, annotationsChanged: false, statsChanged: false,
          topologyChanged: false, thumbnailOnly: false, browseRevision: getBrowseRevision(db) };
      }
      if (input.modifiedAt < existing.modified_at) {
        return { affectedPaths: [], rowsChanged: false, annotationsChanged: false, statsChanged: false,
          topologyChanged: false, thumbnailOnly: false, browseRevision: getBrowseRevision(db) };
      }
      const contentChanged = input.kind === 'change'
        || existing.size_bytes !== input.sizeBytes
        || existing.modified_at !== input.modifiedAt;
      const rowChanged = contentChanged
        || existing.name !== input.name
        || existing.extension !== input.extension
        || existing.directory !== input.directory;
      if (!rowChanged) return { affectedPaths: [], rowsChanged: false, annotationsChanged: false,
        statsChanged: false, topologyChanged: false, thumbnailOnly: false, browseRevision: getBrowseRevision(db) };

      if (contentChanged) {
        const contentRevision = allocateContentRevision(db);
        updateFile.run(input.name, input.extension, input.directory, input.sizeBytes, input.modifiedAt,
          0, 0, null, null, 0, Date.now(), contentRevision, archivePath, 0, existing.id);
        if (enrichment) {
          updateEnrichment.run(enrichment.vertexCount, enrichment.faceCount,
            enrichment.dimensions ? JSON.stringify(enrichment.dimensions) : null,
            existing.id, input.path, contentRevision);
          writeThumbnailState.run(enrichment.thumbnailPath, enrichment.thumbnailFailed, existing.id, contentRevision);
        }
      } else {
        updateUnchangedScan.run(input.name, input.extension, input.directory, Date.now(), 0, existing.id);
      }
      return makeMutation([input.path], { rows: true, stats: contentChanged, topology: existing.directory !== input.directory });
    })();
    notify(result, result.affectedPaths);
    return result;
  }

  function applyIndexBatchInternal(input: IndexBatch, preserveScanGeneration = false): IndexBatchResult {
    const inputByPath = new Map(input.records.map((record) => [record.path, record]));
    const records = [...inputByPath.values()];
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const committed: IndexBatchResult['committed'] = [];
    const changedPaths: string[] = [];
    let statsChanged = false;
    let topologyChanged = false;
    let browseRevision = getBrowseRevision(db);

    for (let start = 0; start < records.length; start += 250) {
      const batch = records.slice(start, start + 250);
      const transaction = db.transaction(() => {
        const paths = batch.map((record) => record.path);
        while (paths.length < batchSize) paths.push(null as unknown as string);
        const existingRows = findBatch.all(...paths) as Array<RevisionedFileRecord & {
          size_bytes: number; modified_at: number; id: number;
        }>;
        const existingByPath = new Map(existingRows.map((row) => [row.path, row]));
        let batchRowsChanged = false;
        let batchStatsChanged = false;
        let batchTopologyChanged = false;
        for (const record of batch) {
          const existing = existingByPath.get(record.path);
          const archivePath = parseArchiveEntryPath(record.path)?.archivePath ?? null;
          const now = Date.now();
          if (!existing) {
            const contentRevision = allocateContentRevision(db);
            const result = insertFile.run(record.path, record.name, record.extension, record.directory,
              record.sizeBytes, record.modifiedAt, now, contentRevision, archivePath, input.scanGeneration);
            const id = Number(result.lastInsertRowid);
            insertScopesForPath(id, record.path);
            committed.push({ id, path: record.path, contentRevision });
            inserted++;
            batchRowsChanged = true;
            batchStatsChanged = true;
            batchTopologyChanged = true;
            statsChanged = true;
            topologyChanged = true;
            changedPaths.push(record.path);
            continue;
          }
          if (record.expectedContentRevision !== undefined && record.expectedContentRevision !== existing.content_revision) {
            unchanged++;
            continue;
          }
          if (record.modifiedAt < existing.modified_at) {
            unchanged++;
            continue;
          }
          const contentChanged = record.modifiedAt !== existing.modified_at || record.sizeBytes !== existing.size_bytes;
          const displayChanged = record.name !== existing.name || record.extension !== existing.extension
            || record.directory !== existing.directory;
          if (contentChanged) {
            const contentRevision = allocateContentRevision(db);
            if (preserveScanGeneration) {
              updateFilePreservingGeneration.run(record.name, record.extension, record.directory, record.sizeBytes,
                record.modifiedAt, 0, 0, null, null, 0, now, contentRevision, archivePath, existing.id);
            } else {
              updateFile.run(record.name, record.extension, record.directory, record.sizeBytes, record.modifiedAt,
                0, 0, null, null, 0, now, contentRevision, archivePath, input.scanGeneration, existing.id);
            }
            committed.push({ id: existing.id, path: record.path, contentRevision });
            updated++;
            batchRowsChanged = true;
            batchStatsChanged = true;
            batchTopologyChanged ||= record.directory !== existing.directory;
            statsChanged = true;
            topologyChanged ||= record.directory !== existing.directory;
            changedPaths.push(record.path);
          } else if (displayChanged) {
            if (preserveScanGeneration) {
              updateUnchangedPreservingGeneration.run(record.name, record.extension, record.directory, now, existing.id);
            } else {
              updateUnchangedScan.run(record.name, record.extension, record.directory, now, input.scanGeneration, existing.id);
            }
            committed.push({ id: existing.id, path: record.path, contentRevision: existing.content_revision });
            updated++;
            batchRowsChanged = true;
            batchTopologyChanged ||= record.directory !== existing.directory;
            topologyChanged ||= record.directory !== existing.directory;
            changedPaths.push(record.path);
          } else {
            if (!preserveScanGeneration) {
              updateUnchangedScan.run(record.name, record.extension, record.directory, now, input.scanGeneration, existing.id);
            }
            unchanged++;
            committed.push({ id: existing.id, path: record.path, contentRevision: existing.content_revision });
          }
        }
        if (batchRowsChanged || batchStatsChanged || batchTopologyChanged) {
          const revisions = advanceLibraryRevisions(db, { browse: batchRowsChanged, stats: batchStatsChanged, topology: batchTopologyChanged });
          browseRevision = revisions.browseRevision;
        }
      });
      transaction();
    }

    const mutation: IndexMutationResult = {
      affectedPaths: [...new Set(changedPaths)], rowsChanged: changedPaths.length > 0,
      annotationsChanged: false, statsChanged,
      topologyChanged, thumbnailOnly: false, browseRevision,
    };
    notify(mutation, changedPaths);
    return { inserted, updated, unchanged, browseRevision, committed };
  }

  function applyIndexBatch(input: IndexBatch): IndexBatchResult {
    return applyIndexBatchInternal(input);
  }

  function applyLegacyScan(file: ScannedFileRecord) {
    const result = applyIndexBatchInternal({
      scanGeneration: 0,
      records: [{
        path: file.path, name: file.name, extension: file.ext, directory: file.dir,
        sizeBytes: file.size, modifiedAt: file.mtime, scanGeneration: 0,
      }],
    }, true);
    const identity = result.committed.find((entry) => entry.path === file.path);
    if (!identity) return;
    applyMetadataResult({
      fileId: identity.id, path: identity.path, expectedContentRevision: identity.contentRevision,
      vertexCount: file.vertexCount, faceCount: file.faceCount,
      dimensions: file.dimensions ? JSON.stringify(file.dimensions) : null,
    });
  }

  function applyLegacyWatch(file: WatchedFileRecord) {
    commitWatchAddOrChange({
      kind: 'change', path: file.path, name: file.name, extension: file.ext, directory: file.dir,
      sizeBytes: file.size, modifiedAt: file.modifiedAt, archivePath: parseArchiveEntryPath(file.path)?.archivePath ?? null,
    }, {
      vertexCount: file.vertexCount, faceCount: file.faceCount, dimensions: file.dimensions,
      thumbnailPath: file.thumbnailPath, thumbnailFailed: file.thumbnailFailed,
    });
  }

  function applyWatchUpdate(input: WatchUpdate): IndexMutationResult {
    if (input.kind !== 'remove') return commitWatchAddOrChange(input);
    const result = db.transaction(() => {
      const row = db.prepare('SELECT id, content_revision FROM files WHERE path = ?').get(input.path) as { id: number; content_revision: number } | undefined;
      if (!row || row.content_revision !== input.expectedContentRevision) {
        return { affectedPaths: [], rowsChanged: false, annotationsChanged: false, statsChanged: false,
          topologyChanged: false, thumbnailOnly: false, browseRevision: getBrowseRevision(db) };
      }
      removeScopesById.run(row.id);
      deleteById.run(row.id);
      return makeMutation([input.path], { rows: true, stats: true, topology: true });
    })();
    notify(result, result.affectedPaths);
    return result;
  }

  function deleteContainedFiles(rootPath: string, candidates: PruneCandidate[]): IndexMutationResult {
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
    const deletedPaths: string[] = [];
    let browseRevision = getBrowseRevision(db);
    for (let start = 0; start < uniqueCandidates.length; start += 250) {
      const batch = uniqueCandidates.slice(start, start + 250);
      const chunk = db.transaction(() => {
      const candidatePaths = batch.map((candidate) => candidate.path);
      while (candidatePaths.length < 250) candidatePaths.push(null as unknown as string);
      const rows = findCandidateRows.all(...candidatePaths) as Array<{ id: number; path: string; content_revision: number; scan_generation: number }>;
      const candidatesByPath = new Map(batch.map((candidate) => [candidate.path, candidate]));
      const deleted: string[] = [];
      for (const row of rows) {
        const candidate = candidatesByPath.get(row.path)!;
        if (!isPathContained(rootPath, row.path)
          || row.scan_generation !== candidate.scanGeneration
          || row.content_revision !== candidate.expectedContentRevision) continue;
        removeScopesById.run(row.id);
        deleteById.run(row.id);
        deleted.push(row.path);
      }
      return deleted.length > 0 ? makeMutation(deleted, { rows: true, stats: true, topology: true })
        : { affectedPaths: [], rowsChanged: false, annotationsChanged: false, statsChanged: false,
          topologyChanged: false, thumbnailOnly: false, browseRevision: getBrowseRevision(db) };
      })();
      deletedPaths.push(...chunk.affectedPaths);
      browseRevision = chunk.browseRevision;
    }
    const result: IndexMutationResult = {
      affectedPaths: [...new Set(deletedPaths)], rowsChanged: deletedPaths.length > 0,
      annotationsChanged: false, statsChanged: deletedPaths.length > 0,
      topologyChanged: deletedPaths.length > 0, thumbnailOnly: false, browseRevision,
    };
    notify(result, result.affectedPaths);
    return result;
  }

  function applyMetadataResult(input: MetadataEnrichmentUpdate): MetadataEnrichmentResult {
    const result = db.transaction(() => {
      const row = findByIdAndRevision.get(input.fileId, input.expectedContentRevision) as {
        path: string; content_revision: number; vertex_count: number; face_count: number; dimensions: string | null;
      } | undefined;
      if (!row) {
        const current = findCurrentRevision.get(input.fileId) as { content_revision: number } | undefined;
        return current ? { status: 'stale' as const, currentContentRevision: current.content_revision } : { status: 'missing' as const };
      }
      if (row.path !== input.path) return { status: 'stale' as const, currentContentRevision: row.content_revision };
      if (row.vertex_count === input.vertexCount && row.face_count === input.faceCount && row.dimensions === input.dimensions) {
        return { status: 'updated' as const, contentRevision: input.expectedContentRevision };
      }
      updateEnrichment.run(input.vertexCount, input.faceCount, input.dimensions, input.fileId, input.path, input.expectedContentRevision);
      const mutation = makeMutation([input.path], { rows: true, stats: true });
      return { status: 'updated' as const, contentRevision: input.expectedContentRevision, mutation };
    })();
    if (result.status === 'updated' && 'mutation' in result && result.mutation !== undefined) {
      const mutation = result.mutation;
      notify(mutation, mutation.affectedPaths);
      return { status: 'updated', contentRevision: result.contentRevision };
    }
    return result;
  }

  function updateFileMetadata(input: RevisionGuardedMetadataUpdate): RevisionGuardedMetadataResult {
    const result = db.transaction(() => {
      const row = findByIdAndRevision.get(input.fileId, input.expectedContentRevision) as (RevisionedFileRecord & Record<string, unknown>) | undefined;
      if (!row) {
        const current = findCurrentRevision.get(input.fileId) as { content_revision: number } | undefined;
        return current ? { status: 'stale' as const, currentContentRevision: current.content_revision }
          : { status: 'missing' as const };
      }
      const tags = input.tags === undefined ? row.tags : input.tags === null ? null : JSON.stringify(input.tags);
      const notes = input.notes === undefined ? row.notes : input.notes;
      if (tags !== row.tags || notes !== row.notes) {
        updateAnnotations.run(tags, notes, input.fileId, input.expectedContentRevision);
        const mutation = makeMutation([row.path], { annotations: true });
        const updated = findFileById.get(input.fileId) as FileRecord;
        return { status: 'updated' as const, file: updated, browseRevision: mutation.browseRevision, mutation };
      }
      return { status: 'updated' as const, file: row as unknown as FileRecord, browseRevision: getBrowseRevision(db) };
    })();
    if (result.status === 'updated' && 'mutation' in result && result.mutation) {
      const { mutation, ...publicResult } = result;
      notify(mutation, mutation.affectedPaths);
      return publicResult;
    }
    return result;
  }

  function updateThumbnailState(input: ThumbnailStateUpdate): ThumbnailStateUpdateResult {
    const result = db.transaction(() => {
      const row = findThumbnailState.get(input.fileId, input.expectedContentRevision) as {
        path: string; thumbnail: string | null; thumbnail_failed: number;
      } | undefined;
      if (!row) {
        const current = findCurrentRevision.get(input.fileId) as { content_revision: number } | undefined;
        return current ? { status: 'stale' as const, currentContentRevision: current.content_revision }
          : { status: 'missing' as const };
      }
      if (row.thumbnail === input.thumbnailPath && row.thumbnail_failed === input.thumbnailFailed) {
        return { status: 'updated' as const, contentRevision: input.expectedContentRevision };
      }
      writeThumbnailState.run(input.thumbnailPath, input.thumbnailFailed, input.fileId, input.expectedContentRevision);
      const mutation: IndexMutationResult = {
        affectedPaths: [row.path], rowsChanged: false, annotationsChanged: false,
        statsChanged: false, topologyChanged: false, thumbnailOnly: true,
        browseRevision: getBrowseRevision(db),
      };
      return { status: 'updated' as const, contentRevision: input.expectedContentRevision, mutation };
    })();
    if (result.status === 'updated' && 'mutation' in result && result.mutation) {
      notify(result.mutation, result.mutation.affectedPaths);
    }
    if (result.status === 'updated') return { status: result.status, contentRevision: result.contentRevision };
    return result;
  }

  function getFileContentRevision(fileId: number): number | null {
    const row = findContentRevision.get(fileId) as { content_revision: number } | undefined;
    return row?.content_revision ?? null;
  }

  return {
    applyIndexBatch,
    applyWatchUpdate,
    deleteContainedFiles,
    applyMetadataResult,
    updateFileMetadata,
    updateThumbnailState,
    getBrowseRevision: () => getBrowseRevision(db),
    getFileContentRevision,
    applyLegacyScan,
    applyLegacyWatch,
  };
}

const legacyRepositories = new WeakMap<Database, FileIndexRepository>();

function getLegacyRepository(db: Database): FileIndexRepository {
  let repository = legacyRepositories.get(db);
  if (!repository) {
    repository = createFileIndexRepository(db);
    legacyRepositories.set(db, repository);
  }
  return repository;
}
