export class SlicerContextLaunchFence {
  private generation = 0;

  beginLookup(): number {
    this.generation++;
    return this.generation;
  }

  noteUserIntent(): void {
    this.generation++;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

export function isPathInsideRoot(candidatePath: string, rootPath: string, caseInsensitive = false): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  let candidate = normalize(candidatePath);
  let root = normalize(rootPath);
  const windowsPath = /^[a-z]:\//i.test(root) || root.startsWith('//');
  if (caseInsensitive || windowsPath) {
    candidate = candidate.toLowerCase();
    root = root.toLowerCase();
  }
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith('/') ? root : `${root}/`);
}

export function beginSlicerContextRootRemoval(
  fence: SlicerContextLaunchFence,
  activeFolder: string | null,
  removedRoot: string,
): boolean {
  fence.noteUserIntent();
  return activeFolder !== null && isPathInsideRoot(activeFolder, removedRoot);
}

export function fenceCollectionScopeChange(
  fence: SlicerContextLaunchFence,
  activeCollectionId: string | null,
  affectedCollectionId: string,
  nextActiveCollectionId = activeCollectionId,
): boolean {
  const changesScope = nextActiveCollectionId !== activeCollectionId
    || affectedCollectionId === activeCollectionId;
  if (changesScope) fence.noteUserIntent();
  return changesScope;
}

export async function applySlicerContextLookupIfCurrent<T>(
  fence: SlicerContextLaunchFence,
  generation: number,
  lookup: () => Promise<T>,
  apply: (value: T) => void,
): Promise<boolean> {
  const value = await lookup();
  if (!fence.isCurrent(generation)) return false;
  apply(value);
  return true;
}
