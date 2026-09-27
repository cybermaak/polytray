import path from 'path';
import type { Database } from 'better-sqlite3';
import {
  ARCHIVE_ENTRY_SEPARATOR,
  normalizeArchiveEntryPath,
  parseArchiveEntryPath,
} from '../shared/archivePaths';

export type ScopePlatform = 'win32' | 'posix';

function pathApi(platform: ScopePlatform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizeNativeScope(value: string, platform: ScopePlatform) {
  const normalized = pathApi(platform).resolve(value);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizeArchiveHeader(value: string, platform: ScopePlatform) {
  // Archive-header equality intentionally follows isPathContained's case-sensitive resolved-path comparison.
  return pathApi(platform).resolve(value);
}

function normalizeVirtualEntry(value: string) {
  const normalized = path.posix.normalize(normalizeArchiveEntryPath(value));
  return normalized === '.' ? '' : normalized;
}

function parseArchiveScope(value: string): { archivePath: string; entryPath: string } | null {
  const separatorIndex = value.indexOf(ARCHIVE_ENTRY_SEPARATOR);
  if (separatorIndex <= 0) return null;
  return {
    archivePath: value.slice(0, separatorIndex),
    entryPath: normalizeVirtualEntry(value.slice(separatorIndex + ARCHIVE_ENTRY_SEPARATOR.length)),
  };
}

function nativeAncestors(directory: string, platform: ScopePlatform, normalizeCase = true) {
  const api = pathApi(platform);
  const scopes: string[] = [];
  let current = api.resolve(directory);
  while (true) {
    scopes.push(normalizeCase ? normalizeNativeScope(current, platform) : current);
    const parent = api.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return scopes.reverse();
}

/** Enumerates exactly the canonical scope keys which contain an indexed file. */
export function enumerateFileScopes(filePath: string): string[] {
  return enumerateFileScopesForPlatform(filePath, process.platform === 'win32' ? 'win32' : 'posix');
}

export function enumerateFileScopesForPlatform(filePath: string, platform: ScopePlatform): string[] {
  const api = pathApi(platform);
  const archive = parseArchiveEntryPath(filePath);
  if (!archive) return nativeAncestors(api.dirname(api.resolve(filePath)), platform);

  const canonicalArchivePath = normalizeArchiveHeader(archive.archivePath, platform);
  const virtualRoot = `${canonicalArchivePath}${ARCHIVE_ENTRY_SEPARATOR}`;
  const scopes = nativeAncestors(canonicalArchivePath, platform);
  const normalizedEntryPath = normalizeVirtualEntry(archive.entryPath);
  const parts = normalizedEntryPath.split('/');
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
export function canonicalizeScopePath(scopePath: string, platform: ScopePlatform = process.platform === 'win32' ? 'win32' : 'posix'): string {
  const archive = parseArchiveScope(scopePath);
  if (!archive) return normalizeNativeScope(scopePath, platform);
  const virtualRoot = `${normalizeArchiveHeader(archive.archivePath, platform)}${ARCHIVE_ENTRY_SEPARATOR}`;
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
