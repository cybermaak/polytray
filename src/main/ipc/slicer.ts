import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import { getDb } from '../database';
import { IPC, type SlicerConfiguration, type SlicerHandoffRequest, type SlicerHandoffResult } from '../../shared/types';
import { createPlatformLauncher, createSlicerHandoff, type SlicerPlatform } from '../slicerHandoff';
import { parseSlicerHandoffRequest, parseSlicerRequestId } from './runtimeValidation';

type MainWindowGetter = () => BrowserWindow | null;
interface DialogAdapter {
  showOpenDialog(window: BrowserWindow, options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue>;
}
interface HandoffService {
  open(request: SlicerHandoffRequest, signal?: AbortSignal): Promise<SlicerHandoffResult>;
}
interface IpcDependencies {
  platform: SlicerPlatform;
  getMainWindow: MainWindowGetter;
  handoff: HandoffService;
  dialog: DialogAdapter;
}

const activeBySender = new Map<number, Map<string, AbortController>>();
function assertMainRenderer(event: IpcMainInvokeEvent, getMainWindow: MainWindowGetter): BrowserWindow {
  const window = getMainWindow();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Slicer handoff is available only to the main Polytray window.');
  }
  return window;
}

export function createSlicerIpcHandlers(deps: IpcDependencies) {
  function senderRequests(sender: WebContents) {
    let requests = activeBySender.get(sender.id);
    if (!requests) {
      requests = new Map();
      activeBySender.set(sender.id, requests);
      sender.once('destroyed', () => {
        for (const controller of requests!.values()) controller.abort();
        activeBySender.delete(sender.id);
      });
    }
    return requests;
  }
  return {
    async open(event: IpcMainInvokeEvent, raw: unknown): Promise<SlicerHandoffResult> {
      assertMainRenderer(event, deps.getMainWindow);
      const request = parseSlicerHandoffRequest(raw, deps.platform);
      const requests = senderRequests(event.sender);
      if (requests.has(request.requestId)) return { status: 'failed', code: 'launch-failed', message: 'This handoff is already in progress.' };
      const controller = new AbortController();
      requests.set(request.requestId, controller);
      try { return await deps.handoff.open(request, controller.signal); }
      finally {
        requests.delete(request.requestId);
        if (requests.size === 0) activeBySender.delete(event.sender.id);
      }
    },
    cancel(event: IpcMainInvokeEvent, rawId: unknown): boolean {
      assertMainRenderer(event, deps.getMainWindow);
      const requestId = parseSlicerRequestId(rawId);
      const controller = activeBySender.get(event.sender.id)?.get(requestId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    async pick(event: IpcMainInvokeEvent): Promise<SlicerConfiguration | null> {
      const window = assertMainRenderer(event, deps.getMainWindow);
      const filters = deps.platform === 'win32' ? [{ name: 'Applications', extensions: ['exe'] }] : undefined;
      const properties: Electron.OpenDialogOptions['properties'] = deps.platform === 'darwin'
        ? ['openFile', 'treatPackageAsDirectory']
        : ['openFile'];
      const result = await deps.dialog.showOpenDialog(window, {
        title: 'Choose slicer application', properties, filters,
      });
      const selected = result.filePaths[0];
      if (result.canceled || !selected) return null;
      return { applicationPath: selected, useSystemDefault: false };
    },
  };
}

export function registerSlicerHandlers(getMainWindow: MainWindowGetter) {
  const platform = process.platform as SlicerPlatform;
  const handoff = createSlicerHandoff({
    userDataPath: app.getPath('userData'),
    platform,
    lookupIndexedFile(filePath) {
      return getDb().prepare('SELECT id, content_revision AS contentRevision, path, extension FROM files WHERE path = ?').get(filePath) as {
        id: number; contentRevision: number; path: string; extension: string;
      } | undefined ?? null;
    },
    launch: createPlatformLauncher(platform),
    validateApplication: async configuration => {
      if (configuration.useSystemDefault || !configuration.applicationPath) return true;
      const fsPromises = await import('node:fs/promises');
      const stat = await fsPromises.lstat(configuration.applicationPath).catch(() => null);
      if (!stat || stat.isSymbolicLink()) return false;
      if (platform === 'linux') {
        if (!stat.isFile()) return false;
        return fsPromises.access(configuration.applicationPath, fs.constants.X_OK).then(() => true).catch(() => false);
      }
      return platform === 'darwin' ? stat.isDirectory() : stat.isFile();
    },
  });
  const handlers = createSlicerIpcHandlers({
    platform, getMainWindow, handoff,
    dialog: { showOpenDialog: (window, options) => dialog.showOpenDialog(window, options) },
  });
  ipcMain.handle(IPC.OPEN_IN_SLICER, handlers.open);
  ipcMain.handle(IPC.CANCEL_SLICER_HANDOFF, handlers.cancel);
  ipcMain.handle(IPC.PICK_SLICER_APPLICATION, handlers.pick);
  return {
    async cleanup() { await handoff.cleanupOldFiles(); },
    dispose() { cancelAllSlicerHandoffs(); },
  };
}

export function cancelAllSlicerHandoffs() {
  for (const requests of activeBySender.values()) for (const controller of requests.values()) controller.abort();
  activeBySender.clear();
}
