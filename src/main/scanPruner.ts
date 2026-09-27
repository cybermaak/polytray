import type { Database } from 'better-sqlite3';
import { filterContainedPaths } from './pathContainment';
import {
  decidePruneCandidates,
  matchesScanSnapshot,
  type ScanSnapshotRow,
} from './scanCoverage';
import type { ScanDiscovery } from './scanner';

export function captureScanPruneSnapshot(db: Database, rootPath: string): ScanSnapshotRow[] {
  const rows = db.prepare(`
    SELECT id, path, indexed_at, modified_at, size_bytes, tags, notes, print_status FROM files
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
  const deleteSnapshot = db.prepare(`
    DELETE FROM files
    WHERE id = ? AND path = ? AND indexed_at = ? AND modified_at = ? AND size_bytes = ?
      AND tags IS ? AND notes IS ? AND print_status IS ?
  `);
  const readCurrent = db.prepare(`
    SELECT id, path, indexed_at, modified_at, size_bytes, tags, notes, print_status
    FROM files WHERE id = ?
  `);
  const snapshotById = new Map(snapshot.map((row) => [row.id, row]));
  let deletedCount = 0;
  for (const candidate of decision.prune) {
    const row = snapshotById.get(candidate.id);
    if (!row) continue;
    const current = readCurrent.get(row.id) as ScanSnapshotRow | undefined;
    if (!current || !matchesScanSnapshot(row, current)) continue;
    deletedCount += deleteSnapshot.run(
      row.id, row.path, row.indexed_at, row.modified_at, row.size_bytes,
      row.tags, row.notes, row.print_status,
    ).changes;
  }
  return {
    deletedCount,
    retainedCount: decision.retained + (decision.prune.length - deletedCount),
  };
}
