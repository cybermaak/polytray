import path from 'path';
import type { Database } from 'better-sqlite3';
import type { FileRecord, SortOptions } from '../shared/types';
import type {
  LibraryFileItem,
  LibraryItem,
  LibraryPageResult,
  LibraryQuery,
  LibrarySortField,
  SortDirection,
} from '../shared/libraryQuery';
import { ARCHIVE_ENTRY_SEPARATOR } from '../shared/archivePaths';
import { canonicalizeScopePath, isScopeBackfillComplete } from './fileScopes';

const COLLECTION_TABLE = '__polytray_library_collection_paths';
const PAGE_ARCHIVE_TABLE = '__polytray_library_page_archives';
const COLLECTION_INSERT_BATCH = 500;
const SORT_FIELDS: LibrarySortField[] = ['name', 'size', 'date', 'vertices', 'faces'];
const dbsWithPathFunctions = new WeakSet<Database>();

interface FilterPlan {
  from: string;
  where: string;
  params: Array<string | number>;
}

interface QueryRow {
  kind: 'file' | 'archive';
  item_key: string;
  file_id: number | null;
  item_path: string;
  archive_path: string | null;
  item_name: string;
  item_extension: string;
  item_directory: string | null;
  item_size: number;
  item_date: number;
  item_vertices: number;
  item_faces: number;
  thumbnail: string | null;
  thumbnail_failed: number;
  indexed_at: number;
  tags: string | null;
  notes: string | null;
  dimensions: string | null;
  content_revision: number | null;
  model_count: number;
}

interface SampleRow {
  archive_path: string;
  sample_order: number;
  id: number;
  path: string;
  name: string;
  extension: string;
  directory: string;
  size_bytes: number;
  modified_at: number;
  vertex_count: number;
  face_count: number;
  tags: string | null;
  notes: string | null;
  dimensions: string | null;
  thumbnail: string | null;
  thumbnail_failed: number;
  indexed_at: number;
  content_revision: number;
  archive_path_value: string | null;
}

function ensureSqlFunctions(db: Database) {
  if (dbsWithPathFunctions.has(db)) return;
  db.function('polytray_path_basename', (filePath: string) => path.basename(filePath));
  dbsWithPathFunctions.add(db);
}

function assertValidLibraryQuery(query: LibraryQuery) {
  if (!SORT_FIELDS.includes(query.sort)) throw new Error('Invalid library query sort');
  if (query.direction !== 'ASC' && query.direction !== 'DESC') throw new Error('Invalid library query direction');
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 2000) {
    throw new Error('Invalid library query limit');
  }
  if (!Number.isSafeInteger(query.offset) || query.offset < 0) throw new Error('Invalid library query offset');
  if (query.expectedBrowseRevision !== undefined
    && (!Number.isSafeInteger(query.expectedBrowseRevision) || query.expectedBrowseRevision < 0)) {
    throw new Error('Invalid library query revision');
  }
  if (query.folder !== null && (typeof query.folder !== 'string' || query.folder.length === 0)) {
    throw new Error('Invalid library query folder');
  }
  if (query.extension !== null && (typeof query.extension !== 'string' || query.extension.length === 0)) {
    throw new Error('Invalid library query extension');
  }
  if (typeof query.search !== 'string') throw new Error('Invalid library query search');
  if (query.archivePath !== undefined && query.archivePath !== null
    && (typeof query.archivePath !== 'string' || query.archivePath.length === 0)) {
    throw new Error('Invalid library query archive path');
  }
  if (query.collectionPaths !== null && (!Array.isArray(query.collectionPaths)
    || query.collectionPaths.some((value) => typeof value !== 'string' || value.length === 0))) {
    throw new Error('Invalid library query collection');
  }
}

function escapeLikeLiteral(value: string) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function createFilterPlan(query: LibraryQuery): FilterPlan {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  let from = 'files AS f';
  if (query.folder !== null) {
    from = 'file_scopes AS scopes INNER JOIN files AS f ON f.id = scopes.file_id';
    conditions.push('scopes.scope_path = ?');
    params.push(canonicalizeScopePath(query.folder));
  }
  if (query.extension) {
    conditions.push('f.extension = ?');
    params.push(query.extension.toLowerCase());
  }
  if (query.search.length > 0) {
    const pattern = escapeLikeLiteral(query.search);
    conditions.push("(f.name LIKE ? ESCAPE '\\' OR COALESCE(f.tags, '') LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (query.archivePath !== undefined && query.archivePath !== null) {
    conditions.push('f.archive_path = ?');
    params.push(query.archivePath);
  }
  if (query.collectionPaths !== null) {
    conditions.push(`EXISTS (SELECT 1 FROM temp.${COLLECTION_TABLE} AS collection_paths WHERE collection_paths.path = f.path)`);
  }
  return { from, where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function filteredCte(filter: FilterPlan) {
  return `WITH filtered AS MATERIALIZED (
    SELECT f.* FROM ${filter.from} ${filter.where}
  )`;
}

function ensureScopeIndexReady(db: Database) {
  const row = db.prepare('SELECT complete FROM scope_backfill WHERE singleton = 1').get() as { complete: number } | undefined;
  if (row?.complete !== 1) throw new Error('Library scope index is not ready');
}

function withReadSnapshot<T>(db: Database, operation: () => T): T {
  return db.transaction(operation).deferred();
}

function insertTempPaths(db: Database, table: string, paths: string[]) {
  const fullStatement = db.prepare(`INSERT OR IGNORE INTO temp.${table}(path)
    VALUES ${Array.from({ length: COLLECTION_INSERT_BATCH }, () => '(?)').join(',')}`);
  for (let offset = 0; offset < paths.length; offset += COLLECTION_INSERT_BATCH) {
    const batch = paths.slice(offset, offset + COLLECTION_INSERT_BATCH);
    if (batch.length === COLLECTION_INSERT_BATCH) {
      fullStatement.run(...batch);
    } else {
      const statement = db.prepare(`INSERT OR IGNORE INTO temp.${table}(path)
        VALUES ${Array.from({ length: batch.length }, () => '(?)').join(',')}`);
      statement.run(...batch);
    }
  }
}

function beginCollectionMembership(db: Database, paths: string[]) {
  db.exec(`DROP TABLE IF EXISTS temp.${COLLECTION_TABLE};
    CREATE TEMP TABLE ${COLLECTION_TABLE} (path TEXT PRIMARY KEY) WITHOUT ROWID;`);
  insertTempPaths(db, COLLECTION_TABLE, paths);
}

function isVirtualArchiveFolder(folder: string | null) {
  return folder !== null && folder.includes(ARCHIVE_ENTRY_SEPARATOR);
}

function shouldCollapseArchives(query: LibraryQuery) {
  return query.archivePath == null
    && query.search.length === 0
    && query.collectionPaths === null
    && !isVirtualArchiveFolder(query.folder);
}

function displayItemsCte(filter: FilterPlan, collapseArchives: boolean) {
  const fileItems = `SELECT
      'file' AS kind,
      'file:' || CAST(f.id AS TEXT) AS item_key,
      f.id AS file_id,
      f.path AS item_path,
      f.archive_path AS archive_path,
      f.name AS item_name,
      f.extension AS item_extension,
      f.directory AS item_directory,
      f.size_bytes AS item_size,
      f.modified_at AS item_date,
      f.vertex_count AS item_vertices,
      f.face_count AS item_faces,
      f.thumbnail AS thumbnail,
      f.thumbnail_failed AS thumbnail_failed,
      f.indexed_at AS indexed_at,
      f.tags AS tags,
      f.notes AS notes,
      f.dimensions AS dimensions,
      f.content_revision AS content_revision,
      1 AS model_count
    FROM filtered AS f ${collapseArchives ? 'WHERE f.archive_path IS NULL' : ''}`;
  const archiveItems = collapseArchives ? `UNION ALL
    SELECT
      'archive' AS kind,
      'archive:' || f.archive_path AS item_key,
      NULL AS file_id,
      f.archive_path AS item_path,
      f.archive_path AS archive_path,
      polytray_path_basename(f.archive_path) AS item_name,
      'zip' AS item_extension,
      NULL AS item_directory,
      SUM(f.size_bytes) AS item_size,
      MAX(f.modified_at) AS item_date,
      SUM(f.vertex_count) AS item_vertices,
      SUM(f.face_count) AS item_faces,
      NULL AS thumbnail,
      0 AS thumbnail_failed,
      MAX(f.indexed_at) AS indexed_at,
      NULL AS tags,
      NULL AS notes,
      NULL AS dimensions,
      NULL AS content_revision,
      COUNT(*) AS model_count
    FROM filtered AS f
    WHERE f.archive_path IS NOT NULL
    GROUP BY f.archive_path` : '';
  return `${filteredCte(filter)}, display_items AS (${fileItems} ${archiveItems})`;
}

function sortExpression(sort: LibrarySortField) {
  switch (sort) {
    case 'name': return 'item_name COLLATE NOCASE';
    case 'size': return 'item_size';
    case 'date': return 'item_date';
    case 'vertices': return 'item_vertices';
    case 'faces': return 'item_faces';
  }
}

function rowToFileRecord(row: SampleRow): FileRecord {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    extension: row.extension,
    directory: row.directory,
    size_bytes: row.size_bytes,
    modified_at: row.modified_at,
    vertex_count: row.vertex_count,
    face_count: row.face_count,
    thumbnail: row.thumbnail,
    thumbnail_failed: row.thumbnail_failed,
    indexed_at: row.indexed_at,
    tags: row.tags,
    notes: row.notes,
    dimensions: row.dimensions,
    content_revision: row.content_revision,
    archive_path: row.archive_path_value,
  };
}

function pageRowToItem(row: QueryRow, samples: Map<string, FileRecord[]>): LibraryItem {
  if (row.kind === 'file') {
    const file: FileRecord = {
      id: row.file_id!,
      path: row.item_path,
      name: row.item_name,
      extension: row.item_extension,
      directory: row.item_directory!,
      size_bytes: row.item_size,
      modified_at: row.item_date,
      vertex_count: row.item_vertices,
      face_count: row.item_faces,
      thumbnail: row.thumbnail,
      thumbnail_failed: row.thumbnail_failed,
      indexed_at: row.indexed_at,
      tags: row.tags,
      notes: row.notes,
      dimensions: row.dimensions,
      content_revision: row.content_revision!,
      archive_path: row.archive_path,
    };
    return { kind: 'file', key: `file:${file.id}`, file };
  }
  return {
    kind: 'archive',
    key: `archive:${row.archive_path!}`,
    archivePath: row.archive_path!,
    name: row.item_name,
    modelCount: row.model_count,
    vertexCount: row.item_vertices,
    faceCount: row.item_faces,
    sizeBytes: row.item_size,
    thumbnailSamples: samples.get(row.archive_path!) ?? [],
  };
}

export function getLibraryPage(db: Database, query: LibraryQuery): LibraryPageResult {
  assertValidLibraryQuery(query);
  ensureSqlFunctions(db);
  return withReadSnapshot(db, () => {
    const revisionRow = db.prepare('SELECT browse_revision FROM library_revisions WHERE singleton = 1').get() as { browse_revision: number };
    const revision = revisionRow.browse_revision;
    if (query.expectedBrowseRevision !== undefined && query.expectedBrowseRevision !== revision) {
      return { status: 'stale', revision };
    }
    ensureScopeIndexReady(db);

    const collectionPaths = query.collectionPaths;
    if (collectionPaths !== null) beginCollectionMembership(db, collectionPaths);
    try {
      const filter = createFilterPlan(query);
      const filterSql = filteredCte(filter);
      const totalModels = (db.prepare(`${filterSql} SELECT COUNT(*) AS count FROM filtered`)
        .get(...filter.params) as { count: number }).count;
      const collapseArchives = shouldCollapseArchives(query);
      const itemsCte = displayItemsCte(filter, collapseArchives);
      const totalItems = (db.prepare(`${itemsCte} SELECT COUNT(*) AS count FROM display_items`)
        .get(...filter.params) as { count: number }).count;
      const pageRows = db.prepare(`${itemsCte}
        SELECT * FROM display_items
        ORDER BY ${sortExpression(query.sort)} ${query.direction}, item_key COLLATE BINARY ASC
        LIMIT ? OFFSET ?`).all(...filter.params, query.limit, query.offset) as QueryRow[];

      const archivePaths = collapseArchives
        ? [...new Set(pageRows.filter((row) => row.kind === 'archive').map((row) => row.archive_path!))]
        : [];
      const samples = new Map<string, FileRecord[]>();
      if (archivePaths.length > 0) {
        db.exec(`DROP TABLE IF EXISTS temp.${PAGE_ARCHIVE_TABLE};
          CREATE TEMP TABLE ${PAGE_ARCHIVE_TABLE} (path TEXT PRIMARY KEY) WITHOUT ROWID;`);
        insertTempPaths(db, PAGE_ARCHIVE_TABLE, archivePaths);
        const sampleRows = db.prepare(`${filterSql}, ranked_samples AS (
          SELECT f.*,
            ROW_NUMBER() OVER (PARTITION BY f.archive_path ORDER BY f.name COLLATE NOCASE ASC, f.id ASC) AS sample_order
          FROM filtered AS f
          INNER JOIN temp.${PAGE_ARCHIVE_TABLE} AS page_archives ON page_archives.path = f.archive_path
        )
        SELECT archive_path, sample_order, id, path, name, extension, directory, size_bytes,
          modified_at, vertex_count, face_count, tags, notes, dimensions, thumbnail,
          thumbnail_failed, indexed_at, content_revision, archive_path AS archive_path_value
        FROM ranked_samples
        WHERE sample_order <= 4
        ORDER BY archive_path, sample_order`).all(...filter.params) as SampleRow[];
        for (const row of sampleRows) {
          const bucket = samples.get(row.archive_path) ?? [];
          bucket.push(rowToFileRecord(row));
          samples.set(row.archive_path, bucket);
        }
        db.exec(`DROP TABLE temp.${PAGE_ARCHIVE_TABLE}`);
      }

      const items = pageRows.map((row) => pageRowToItem(row, samples));
      const nextOffset = query.offset + items.length < totalItems ? query.offset + items.length : null;
      return { status: 'ok', revision, items, totalItems, totalModels, nextOffset };
    } finally {
      if (collectionPaths !== null) db.exec(`DROP TABLE temp.${COLLECTION_TABLE}`);
    }
  });
}

export function getLibraryFiles(
  db: Database,
  options: SortOptions,
): { files: FileRecord[]; total: number } {
  ensureSqlFunctions(db);
  const sort: LibrarySortField = SORT_FIELDS.includes(options.sort as LibrarySortField)
    ? options.sort as LibrarySortField
    : 'name';
  const direction: SortDirection = options.order === 'DESC' ? 'DESC' : 'ASC';
  const limit = options.limit === undefined ? 200 : Math.max(0, Math.floor(options.limit));
  const offset = options.offset === undefined ? 0 : Math.max(0, Math.floor(options.offset));
  const query: LibraryQuery = {
    sort, direction,
    extension: options.extension || null,
    folder: options.folder || null,
    search: options.search ?? '',
    collectionPaths: null,
    limit: Math.max(1, limit),
    offset,
  };
  return withReadSnapshot(db, () => {
    ensureScopeIndexReady(db);
    const filter = createFilterPlan(query);
    const fromAndWhere = `FROM ${filter.from} ${filter.where}`;
    const total = (db.prepare(`SELECT COUNT(*) AS count ${fromAndWhere}`).get(...filter.params) as { count: number }).count;
    const column = {
      name: 'f.name COLLATE NOCASE',
      size: 'f.size_bytes',
      date: 'f.modified_at',
      vertices: 'f.vertex_count',
      faces: 'f.face_count',
    }[sort];
    const files = db.prepare(`SELECT f.* ${fromAndWhere}
      ORDER BY ${column} ${direction}, f.id ASC
      LIMIT ? OFFSET ?`).all(...filter.params, limit, offset) as FileRecord[];
    return { files, total };
  });
}

export function explainLibraryFilesQuery(db: Database, options: SortOptions) {
  const sort: LibrarySortField = SORT_FIELDS.includes(options.sort as LibrarySortField)
    ? options.sort as LibrarySortField
    : 'name';
  const query: LibraryQuery = {
    sort,
    direction: options.order === 'DESC' ? 'DESC' : 'ASC',
    extension: options.extension || null,
    folder: options.folder || null,
    search: options.search ?? '',
    collectionPaths: null,
    limit: Math.max(1, Math.min(2000, Math.floor(options.limit ?? 200))),
    offset: Math.max(0, Math.floor(options.offset ?? 0)),
  };
  const filter = createFilterPlan(query);
  const column = {
    name: 'f.name COLLATE NOCASE',
    size: 'f.size_bytes',
    date: 'f.modified_at',
    vertices: 'f.vertex_count',
    faces: 'f.face_count',
  }[sort];
  return db.prepare(`EXPLAIN QUERY PLAN SELECT f.* FROM ${filter.from} ${filter.where}
    ORDER BY ${column} ${query.direction}, f.id ASC LIMIT ? OFFSET ?`)
    .all(...filter.params, query.limit, query.offset) as Array<{ id: number; parent: number; notused: number; detail: string }>;
}


export function explainLibraryPageQuery(db: Database, query: LibraryQuery) {
  assertValidLibraryQuery(query);
  ensureSqlFunctions(db);
  return withReadSnapshot(db, () => {
    const collectionPaths = query.collectionPaths;
    if (collectionPaths !== null) beginCollectionMembership(db, collectionPaths);
    try {
      const filter = createFilterPlan(query);
      const cte = displayItemsCte(filter, shouldCollapseArchives(query));
      return db.prepare(`EXPLAIN QUERY PLAN ${cte}
        SELECT * FROM display_items
        ORDER BY ${sortExpression(query.sort)} ${query.direction}, item_key COLLATE BINARY ASC
        LIMIT ? OFFSET ?`).all(...filter.params, query.limit, query.offset) as Array<{ id: number; parent: number; notused: number; detail: string }>;
    } finally {
      if (collectionPaths !== null) db.exec(`DROP TABLE temp.${COLLECTION_TABLE}`);
    }
  });
}
