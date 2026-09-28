import type { FileRecord } from '../../shared/types';
import type { PreviewTarget } from '../../shared/previewTarget';

/** Keep the newest content revision when asynchronous row updates arrive out of order. */
export function preferCurrentFileRevision(current: FileRecord, candidate: FileRecord): FileRecord {
  return candidate.id === current.id && candidate.content_revision >= current.content_revision
    ? candidate
    : current;
}

export function patchPreviewTargetFile(target: PreviewTarget | null, candidate: FileRecord): PreviewTarget | null {
  if (!target) return target;
  if (target.kind === 'file') {
    const file = preferCurrentFileRevision(target.file, candidate);
    return file === target.file ? target : { kind: 'file', file };
  }

  let changed = false;
  const thumbnailSamples = target.archive.thumbnailSamples.map((sample) => {
    const next = preferCurrentFileRevision(sample, candidate);
    if (next !== sample) changed = true;
    return next;
  });
  return changed ? { ...target, archive: { ...target.archive, thumbnailSamples } } : target;
}
