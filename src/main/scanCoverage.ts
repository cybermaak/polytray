import path from 'path';
import { parseArchiveEntryPath } from '../shared/archivePaths';
import { isPathContained } from './pathContainment';

export type ScanScopeKind = 'directory' | 'archive';
export interface ScanScope {
  scopePath: string;
  kind: ScanScopeKind;
  status: 'complete' | 'error' | 'excluded';
  phase?: 'readdir' | 'stat' | 'archive' | 'cancelled' | 'excluded';
  reason?: string;
}
export type ScanTerminalState = 'completed' | 'partial' | 'failed' | 'cancelled';
export interface PruneCandidate { id: number; path: string; generation: number; }

export interface ScanSnapshotRow {
  id: number;
  path: string;
  indexed_at: number;
  modified_at: number;
  size_bytes: number;
  tags: string | null;
  notes: string | null;
  print_status: string | null;
}

export function matchesScanSnapshot(snapshot: ScanSnapshotRow, current: ScanSnapshotRow) {
  return snapshot.id === current.id && snapshot.path === current.path &&
    snapshot.indexed_at === current.indexed_at && snapshot.modified_at === current.modified_at &&
    snapshot.size_bytes === current.size_bytes && snapshot.tags === current.tags &&
    snapshot.notes === current.notes && snapshot.print_status === current.print_status;
}

export function decidePruneCandidates(input: {
  rootPath: string;
  state: ScanTerminalState;
  scopes: ScanScope[];
  discoveredPaths: string[];
  candidates: PruneCandidate[];
}) {
  const prune: PruneCandidate[] = [];
  const discovered = new Set(input.discoveredPaths);
  for (const candidate of input.candidates) {
    if (discovered.has(candidate.path)) continue;
    if (!isPathContained(input.rootPath, candidate.path)) continue;
    if (input.state === 'cancelled' || input.state === 'failed') continue;
    const parsed = parseArchiveEntryPath(candidate.path);
    const physicalPath = parsed?.archivePath ?? candidate.path;
    const failedScope = input.scopes.some((scope) => scope.status === 'error' &&
      (scope.kind === 'archive'
        ? Boolean(parsed && path.resolve(scope.scopePath) === path.resolve(parsed.archivePath))
        : isPathContained(scope.scopePath, physicalPath)));
    const excludedScope = input.scopes.some((scope) => scope.status === 'excluded' &&
      scope.kind === 'directory' && isPathContained(scope.scopePath, physicalPath));
    if (failedScope || excludedScope) continue;
    const hasCompleteCoverage = input.scopes.some((scope) => scope.status === 'complete' &&
      (scope.kind === 'archive'
        ? Boolean(parsed && path.resolve(scope.scopePath) === path.resolve(parsed.archivePath))
        : isPathContained(scope.scopePath, physicalPath)));
    if (hasCompleteCoverage && Number.isInteger(candidate.generation)) prune.push(candidate);
  }
  return { prune, retained: input.candidates.length - prune.length };
}
