import path from 'path';
import type { Database } from 'better-sqlite3';
import {
  ARCHIVE_ENTRY_SEPARATOR,
  parseArchiveEntryPath,
} from '../shared/archivePaths';

function nativeAncestors(directory: string) {
  const scopes: string[] = [];
  let current = path.resolve(directory);
  while (true) {
    scopes.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return scopes.reverse();
}

/** Enumerates exactly the canonical scope keys which contain an indexed file. */
export function enumerateFileScopes(filePath: string): string[] {
  const archive = parseArchiveEntryPath(filePath);
  if (!archive) return nativeAncestors(path.dirname(path.resolve(filePath)));

  const canonicalArchivePath = path.resolve(archive.archivePath);
  const virtualRoot = `${canonicalArchivePath}${ARCHIVE_ENTRY_SEPARATOR}`;
  const scopes = nativeAncestors(canonicalArchivePath);
  const parts = archive.entryPath.split('/');
  parts.pop();
  let virtual = virtualRoot;
  scopes.push(virtual);
  for (const part of parts) {
    virtual += virtual === virtualRoot ? part : `/${part}`;
    scopes.push(virtual);
  }
  return scopes;
}

/** Canonicalizes a folder key using the same native and virtual rules as membership. */
export function canonicalizeScopePath(scopePath: string): string {
  const archive = parseArchiveEntryPath(scopePath);
  if (!archive) return path.resolve(scopePath);
  const virtualRoot = `${path.resolve(archive.archivePath)}${ARCHIVE_ENTRY_SEPARATOR}`;
  return archive.entryPath ? `${virtualRoot}${archive.entryPath}` : virtualRoot;
}

export interface ScopeBackfillProgress {
  processed: number;
  complete: boolean;
  cursorFileId: number;
}

/** Commits at most one bounded page, persisting its cursor with the scope rows. */
export function backfillFileScopes(db: Database, batchSize = 250): ScopeBackfillProgress {
  const size = Math.max(1, Math.min(2000, Math.floor(batchSize)));
  const transaction = db.transaction(() => {
    const state = db.prepare('SELECT cursor_file_id, complete FROM scope_backfill WHERE singleton = 1')
      .get() as { cursor_file_id: number; complete: number };
    if (state.complete) return { processed: 0, complete: true, cursorFileId: state.cursor_file_id };

    const rows = db.prepare('SELECT id, path FROM files WHERE id > ? ORDER BY id LIMIT ?')
      .all(state.cursor_file_id, size) as Array<{ id: number; path: string }>;
    const insertScope = db.prepare('INSERT OR IGNORE INTO file_scopes (file_id, scope_path) VALUES (?, ?)');
    const updateArchivePath = db.prepare('UPDATE files SET archive_path = ? WHERE id = ? AND archive_path IS NULL');
    for (const row of rows) {
      const archive = parseArchiveEntryPath(row.path);
      updateArchivePath.run(archive?.archivePath ?? null, row.id);
      for (const scope of enumerateFileScopes(row.path)) insertScope.run(row.id, scope);
    }

    const cursorFileId = rows.length > 0 ? rows[rows.length - 1].id : state.cursor_file_id;
    const complete = rows.length < size;
    db.prepare('UPDATE scope_backfill SET cursor_file_id = ?, complete = ? WHERE singleton = 1')
      .run(cursorFileId, complete ? 1 : 0);
    return { processed: rows.length, complete, cursorFileId };
  });
  return transaction();
}

export function isScopeBackfillComplete(db: Database): boolean {
  const state = db.prepare('SELECT complete FROM scope_backfill WHERE singleton = 1').get() as { complete: number } | undefined;
  return state?.complete === 1;
}
