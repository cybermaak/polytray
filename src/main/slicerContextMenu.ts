export interface SlicerContextMenuFile {
  fileId: number;
  path: string;
  extension: string;
  contentRevision: number;
}

export function createSlicerContextMenuAction(
  file: SlicerContextMenuFile | null,
  onOpen: (file: SlicerContextMenuFile) => void,
): { label: string; click: () => void } | null {
  if (!file || !['stl', 'obj', '3mf'].includes(file.extension.toLowerCase())) return null;
  return {
    label: 'Open in Slicer',
    click: () => onOpen(file),
  };
}

export function sendSlicerContextMenuRequest(
  captured: SlicerContextMenuFile,
  lookupCurrent: () => SlicerContextMenuFile | null,
  send: (file: SlicerContextMenuFile) => void,
): boolean {
  const current = lookupCurrent();
  if (!current
    || current.fileId !== captured.fileId
    || current.path !== captured.path
    || current.extension.toLowerCase() !== captured.extension.toLowerCase()
    || current.contentRevision !== captured.contentRevision) return false;
  send(current);
  return true;
}
