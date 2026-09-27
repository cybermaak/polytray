import { app, dialog, ipcMain } from 'electron';
import { getDb } from '../database';
import { createSlicerHandoff, launchSlicer, type SlicerPlatform, type SlicerPlatformConfig } from '../slicerHandoff';

// Keep these transport names aligned with the shared IPC contract wired by the coordinator.
const SLICER_CHANNEL = {
  OPEN_IN_SLICER: 'open-in-slicer',
  CANCEL_SLICER_HANDOFF: 'cancel-slicer-handoff',
  PICK_SLICER_APPLICATION: 'pick-slicer-application',
} as const;

const platform = process.platform as SlicerPlatform;
const handoff = createSlicerHandoff({
  userDataPath: app.getPath('userData'),
  platform,
  lookupIndexedFile(filePath) {
    const row = getDb().prepare('SELECT path, extension FROM files WHERE path = ?').get(filePath) as { path: string; extension: string } | undefined;
    return row ?? null;
  },
  launch: launchSlicer,
});
const activeRequests = new Map<string, AbortController>();

/** Register the explicit user-activated slicer handoff and native app picker. */
export function registerSlicerHandlers() {
  ipcMain.handle(SLICER_CHANNEL.OPEN_IN_SLICER, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') {
      return { status: 'failure', reason: 'not-indexed', action: 'Select an indexed model and try again.' };
    }
    const request = value as { requestId?: unknown; filePath?: unknown; config?: unknown };
    if (typeof request.requestId !== 'string' || !request.requestId.trim() || typeof request.filePath !== 'string' || !request.filePath.trim()) {
      return { status: 'failure', reason: 'not-indexed', action: 'Select an indexed model and try again.' };
    }
    if (activeRequests.has(request.requestId)) return { status: 'failure', reason: 'launch-failed', action: 'This handoff is already in progress.' };
    const controller = new AbortController();
    activeRequests.set(request.requestId, controller);
    try { return await handoff.open(request.filePath, request.config, controller.signal); }
    finally { activeRequests.delete(request.requestId); }
  });

  ipcMain.handle(SLICER_CHANNEL.CANCEL_SLICER_HANDOFF, (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') return false;
    const controller = activeRequests.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  });

  ipcMain.handle(SLICER_CHANNEL.PICK_SLICER_APPLICATION, async () => {
    const filters = platform === 'win32' ? [{ name: 'Applications', extensions: ['exe'] }] : undefined;
    const properties = platform === 'darwin' ? ['openDirectory'] as const : ['openFile'] as const;
    const result = await dialog.showOpenDialog({ title: 'Choose slicer application', properties: [...properties], filters });
    if (result.canceled || !result.filePaths[0]) return null;
    return { kind: 'application', platform, executablePath: result.filePaths[0] } satisfies SlicerPlatformConfig;
  });
}

export async function cleanupSlicerHandoffs() {
  await handoff.cleanupOldFiles();
}
