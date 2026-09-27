import type { Database } from 'better-sqlite3';
import type { LibraryStats } from '../shared/types';
import { getLibraryRevisions } from './libraryRevisions';

interface CachedValue<T> {
  revision: number;
  value: T;
}

export interface LibrarySummaryService {
  getStats(): LibraryStats;
  getDirectories(): string[];
}

const services = new WeakMap<Database, LibrarySummaryService>();

function readStats(db: Database): LibraryStats {
  return db.prepare(`SELECT
    COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN extension = 'stl' THEN 1 ELSE 0 END), 0) AS stl,
    COALESCE(SUM(CASE WHEN extension = 'obj' THEN 1 ELSE 0 END), 0) AS obj,
    COALESCE(SUM(CASE WHEN extension = '3mf' THEN 1 ELSE 0 END), 0) AS threemf,
    COALESCE(SUM(size_bytes), 0) AS totalSize
    FROM files`).get() as LibraryStats;
}

function readDirectories(db: Database): string[] {
  const rows = db.prepare('SELECT DISTINCT directory FROM files ORDER BY directory ASC').all() as Array<{ directory: string }>;
  return rows.map((row) => row.directory);
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createLibrarySummaryService(db: Database): LibrarySummaryService {
  let stats: CachedValue<LibraryStats> | null = null;
  let directories: CachedValue<string[]> | null = null;

  return {
    getStats() {
      const revision = getLibraryRevisions(db).statsRevision;
      if (stats?.revision === revision) return stats.value;

      const snapshot = db.transaction(() => {
        const currentRevision = getLibraryRevisions(db).statsRevision;
        if (stats?.revision === currentRevision) return stats;
        return { revision: currentRevision, value: readStats(db) };
      }).deferred();
      stats = snapshot;
      return snapshot.value;
    },

    getDirectories() {
      const revision = getLibraryRevisions(db).topologyRevision;
      if (directories?.revision === revision) return directories.value;

      const snapshot = db.transaction(() => {
        const currentRevision = getLibraryRevisions(db).topologyRevision;
        if (directories?.revision === currentRevision) return directories;
        const rows = readDirectories(db);
        const value = directories && arraysEqual(directories.value, rows) ? directories.value : rows;
        return { revision: currentRevision, value };
      }).deferred();
      directories = snapshot;
      return snapshot.value;
    },
  };
}

export function getLibrarySummaryService(db: Database): LibrarySummaryService {
  let service = services.get(db);
  if (!service) {
    service = createLibrarySummaryService(db);
    services.set(db, service);
  }
  return service;
}
