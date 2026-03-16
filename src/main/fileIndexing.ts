import type { Database } from 'better-sqlite3';
import type { ModelDimensions } from '../shared/types';

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

const SCAN_UPSERT_SQL = `
  INSERT INTO files (
    path, name, extension, directory, size_bytes, modified_at, vertex_count, face_count, dimensions, thumbnail, thumbnail_failed, indexed_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET
    name = excluded.name,
    extension = excluded.extension,
    directory = excluded.directory,
    size_bytes = excluded.size_bytes,
    modified_at = excluded.modified_at,
    vertex_count = excluded.vertex_count,
    face_count = excluded.face_count,
    dimensions = excluded.dimensions,
    thumbnail = excluded.thumbnail,
    thumbnail_failed = excluded.thumbnail_failed,
    indexed_at = excluded.indexed_at
  WHERE excluded.modified_at >= files.modified_at
`;

const WATCHER_UPSERT_SQL = `
  INSERT INTO files (
    path, name, extension, directory, size_bytes, modified_at, vertex_count, face_count, dimensions, thumbnail, thumbnail_failed, indexed_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET
    name = excluded.name,
    extension = excluded.extension,
    directory = excluded.directory,
    size_bytes = excluded.size_bytes,
    modified_at = excluded.modified_at,
    vertex_count = excluded.vertex_count,
    face_count = excluded.face_count,
    dimensions = excluded.dimensions,
    thumbnail = excluded.thumbnail,
    thumbnail_failed = excluded.thumbnail_failed,
    indexed_at = excluded.indexed_at
  WHERE excluded.modified_at >= files.modified_at
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
  const merged = mergeScannedFileRecord(readIndexedFileRecord(db, file.path), file);
  db.prepare(SCAN_UPSERT_SQL).run(
    merged.path,
    merged.name,
    merged.ext,
    merged.dir,
    merged.size,
    merged.modifiedAt,
    merged.vertexCount,
    merged.faceCount,
    merged.dimensions ? JSON.stringify(merged.dimensions) : null,
    merged.thumbnailPath,
    merged.thumbnailFailed,
    merged.indexedAt,
  );
}

export function applyWatchedFileRecord(db: Database, file: WatchedFileRecord) {
  const merged = mergeWatchedFileRecord(readIndexedFileRecord(db, file.path), file);
  db.prepare(WATCHER_UPSERT_SQL).run(
    merged.path,
    merged.name,
    merged.ext,
    merged.dir,
    merged.size,
    merged.modifiedAt,
    merged.vertexCount,
    merged.faceCount,
    merged.dimensions ? JSON.stringify(merged.dimensions) : null,
    merged.thumbnailPath,
    merged.thumbnailFailed,
    merged.indexedAt,
  );
}

function readIndexedFileRecord(db: Database, filePath: string): IndexedFileRecord | null {
  const row = db
    .prepare(`
      SELECT
        path,
        name,
        extension,
        directory,
        size_bytes,
        modified_at,
        vertex_count,
        face_count,
        dimensions,
        thumbnail,
        thumbnail_failed,
        indexed_at
      FROM files
      WHERE path = ?
    `)
    .get(filePath) as
    | {
        path: string;
        name: string;
        extension: string;
        directory: string;
        size_bytes: number;
        modified_at: number;
        vertex_count: number;
        face_count: number;
        dimensions: string | null;
        thumbnail: string | null;
        thumbnail_failed: number;
        indexed_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    path: row.path,
    name: row.name,
    ext: row.extension,
    dir: row.directory,
    size: row.size_bytes,
    modifiedAt: row.modified_at,
    vertexCount: row.vertex_count,
    faceCount: row.face_count,
    dimensions: row.dimensions ? (JSON.parse(row.dimensions) as ModelDimensions) : null,
    thumbnailPath: row.thumbnail,
    thumbnailFailed: row.thumbnail_failed,
    indexedAt: row.indexed_at,
  };
}
