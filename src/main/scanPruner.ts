import type { Database } from 'better-sqlite3';
import { filterContainedPaths } from './pathContainment';
import { createFileIndexRepository } from './fileIndexing';
import {
  decidePruneCandidates,
  type ScanSnapshotRow,
} from './scanCoverage';
import type { ScanDiscovery } from './scanner';

export function captureScanPruneSnapshot(db: Database, rootPath: string): ScanSnapshotRow[] {
  const rows = db.prepare(`
    SELECT id, path, indexed_at, modified_at, size_bytes, tags, notes, print_status,
      content_revision, scan_generation FROM files
  `).all() as ScanSnapshotRow[];
  const containedPaths = new Set(filterContainedPaths(rootPath, rows.map((row) => row.path)));
  return rows.filter((row) => containedPaths.has(row.path));
}

export function pruneScanSnapshot(
  db: Database,
  rootPath: string,
  discovery: Pick<ScanDiscovery, 'files' | 'scopes' | 'state'>,
  snapshot: ScanSnapshotRow[],
) {
  const decision = decidePruneCandidates({
    rootPath,
    state: discovery.state,
    scopes: discovery.scopes,
    discoveredPaths: discovery.files.map((file) => file.path),
    candidates: snapshot.map((row) => ({ id: row.id, path: row.path, generation: row.indexed_at })),
  });
  const snapshotById = new Map(snapshot.map((row) => [row.id, row]));
  const rowsToDelete = decision.prune
    .map((candidate) => snapshotById.get(candidate.id))
    .filter((row): row is ScanSnapshotRow => row !== undefined);
  const mutation = createFileIndexRepository(db).deleteScanSnapshotRows(rootPath, rowsToDelete);
  const deletedCount = mutation.affectedPaths.length;
  return {
    deletedCount,
    retainedCount: decision.retained + (decision.prune.length - deletedCount),
  };
}
