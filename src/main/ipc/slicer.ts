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

interface SenderRequestRegistry {
  senderId: number;
  sender: WebContents;
  requests: Map<string, AbortController>;
  onNavigation: (_event: Electron.Event, url: string, isInPlace: boolean, isMainFrame: boolean) => void;
  onProcessGone: () => void;
  onDestroyed: () => void;
}
const activeBySender = new Map<number, SenderRequestRegistry>();
function assertMainRenderer(event: IpcMainInvokeEvent, getMainWindow: MainWindowGetter): BrowserWindow {
  const window = getMainWindow();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Slicer handoff is available only to the main Polytray window.');
  }
  return window;
}

export function createSlicerIpcHandlers(deps: IpcDependencies) {
  function registryFor(sender: WebContents, senderId: number) {
    const existing = activeBySender.get(senderId);
    if (existing) return existing;
    const registry = {} as SenderRequestRegistry;
    registry.senderId = senderId;
    registry.sender = sender;
    registry.requests = new Map();
    registry.onNavigation = (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) disposeSenderRegistry(registry);
    };
    registry.onProcessGone = () => disposeSenderRegistry(registry);
    registry.onDestroyed = () => disposeSenderRegistry(registry);
    activeBySender.set(senderId, registry);
    sender.on('did-start-navigation', registry.onNavigation);
    sender.on('render-process-gone', registry.onProcessGone);
    sender.on('destroyed', registry.onDestroyed);
    return registry;
  }
  function finishRequest(registry: SenderRequestRegistry, requestId: string) {
    registry.requests.delete(requestId);
    if (registry.requests.size === 0) disposeSenderRegistry(registry);
  }
  return {
    async open(event: IpcMainInvokeEvent, raw: unknown): Promise<SlicerHandoffResult> {
      assertMainRenderer(event, deps.getMainWindow);
      const sender = event.sender;
      const senderId = sender.id;
      const request = parseSlicerHandoffRequest(raw, deps.platform);
      const registry = registryFor(sender, senderId);
      if (registry.requests.has(request.requestId)) return { status: 'failed', code: 'launch-failed', message: 'This handoff is already in progress.' };
      const controller = new AbortController();
      registry.requests.set(request.requestId, controller);
      try { return await deps.handoff.open(request, controller.signal); }
      finally { finishRequest(registry, request.requestId); }
    },
    cancel(event: IpcMainInvokeEvent, rawId: unknown): boolean {
      assertMainRenderer(event, deps.getMainWindow);
      const requestId = parseSlicerRequestId(rawId);
      const senderId = event.sender.id;
      const controller = activeBySender.get(senderId)?.requests.get(requestId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    async pick(event: IpcMainInvokeEvent): Promise<SlicerConfiguration | null> {
      const window = assertMainRenderer(event, deps.getMainWindow);
      const filters = deps.platform === 'win32' ? [{ name: 'Applications', extensions: ['exe'] }] : undefined;
      const properties: Electron.OpenDialogOptions['properties'] = ['openFile'];
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
  for (const registry of [...activeBySender.values()]) disposeSenderRegistry(registry);
}

function disposeSenderRegistry(registry: SenderRequestRegistry) {
  for (const controller of registry.requests.values()) controller.abort();
  registry.requests.clear();
  registry.sender.removeListener('did-start-navigation', registry.onNavigation);
  registry.sender.removeListener('render-process-gone', registry.onProcessGone);
  registry.sender.removeListener('destroyed', registry.onDestroyed);
  if (activeBySender.get(registry.senderId) === registry) activeBySender.delete(registry.senderId);
}
