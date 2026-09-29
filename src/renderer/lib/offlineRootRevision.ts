export function getOfflineRootRevision(revisions: ReadonlyMap<string, number>, rootKey: string) {
  return revisions.get(rootKey) ?? 0;
}

export function advanceOfflineRootRevision(revisions: Map<string, number>, rootKey: string) {
  const nextRevision = getOfflineRootRevision(revisions, rootKey) + 1;
  revisions.set(rootKey, nextRevision);
  return nextRevision;
}

export function canClearOfflineRootAfterScan(
  scanStartedAt: number,
  currentRevision: number,
  actualJobStartedAt?: number | null,
  unavailableAt?: number | null,
) {
  if (scanStartedAt !== currentRevision) return false;
  if (unavailableAt === undefined || unavailableAt === null) return true;
  return actualJobStartedAt !== undefined && actualJobStartedAt !== null && actualJobStartedAt > unavailableAt;
}
