import { BrowserWindow, MessageChannelMain } from 'electron';
import { join } from 'path';
import { IPC, type PreviewParseDispatchData } from '../shared/types';
import type { PreparedPreview, PreviewParsePortMessage, PreviewParseRequest } from '../shared/previewContracts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export interface PreviewWindowRuntime {
  ensureReady(): Promise<BrowserWindow>;
  parse(request: PreviewParseRequest, sourceBuffer?: ArrayBuffer): Promise<PreparedPreview>;
  markReady(senderId: number): boolean;
  markLost(senderId: number, error?: Error): boolean;
  getCurrentWindow(): BrowserWindow | null;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export function createElectronPreviewWindowManager(): PreviewWindowRuntime {
  let manager: ReturnType<typeof createPreviewWindowManager<BrowserWindow>>;
  manager = createPreviewWindowManager<BrowserWindow>({
    create: () => {
      const previewWindow = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      previewWindow.webContents.on('render-process-gone', (_event, details) => {
        manager.markLost(previewWindow.webContents.id, new Error(`Preview renderer exited: ${details.reason}`));
      });
      previewWindow.on('closed', () => {
        manager.markLost(previewWindow.webContents.id, new Error('Preview window closed'));
      });
      return previewWindow;
    },
    load: (previewWindow) => {
      if (process.env.ELECTRON_RENDERER_URL) {
        return previewWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/src/renderer/preview.html`);
      }
      return previewWindow.loadFile(join(__dirname, '../renderer/preview.html'));
    },
    destroy: async (previewWindow) => {
      if (previewWindow.isDestroyed()) return;
      const closed = new Promise<void>((resolve) => previewWindow.once('closed', () => resolve()));
      try {
        previewWindow.webContents.forcefullyCrashRenderer();
      } catch {
        // The owned renderer may already have exited.
      }
      if (!previewWindow.isDestroyed()) previewWindow.destroy();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([closed, new Promise<void>((resolve) => { timeout = setTimeout(resolve, 500); })]);
      if (timeout) clearTimeout(timeout);
    },
    senderId: (previewWindow) => previewWindow.webContents.id,
    isDestroyed: (previewWindow) => previewWindow.isDestroyed() || previewWindow.webContents.isDestroyed(),
    dispatch: (previewWindow, request, sourceBuffer) => dispatchPreviewParse(previewWindow, request, sourceBuffer),
  });
  return manager;
}

function dispatchPreviewParse(
  previewWindow: BrowserWindow,
  request: PreviewParseRequest,
  sourceBuffer?: ArrayBuffer,
): Promise<PreparedPreview> {
  const channel = new MessageChannelMain();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Preview renderer did not return a result')), 120_000);
    const finish = (error?: Error, preview?: PreparedPreview) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.port1.removeAllListeners();
      channel.port1.close();
      if (error) reject(error);
      else resolve(preview!);
    };
    channel.port1.on('message', (event) => {
      const message = event.data as PreviewParsePortMessage;
      if (!message || message.requestId !== request.requestId) {
        finish(new Error('Preview renderer returned a mismatched request ID'));
      } else if (message.type === 'done') {
        finish(undefined, message.preview);
      } else if (message.type === 'cancelled') {
        finish(new Error(`Preview parse cancelled: ${message.reason}`));
      } else {
        finish(new Error(message.error));
      }
    });
    channel.port1.on('close', () => finish(new Error('Preview renderer response port closed')));
    channel.port1.start();
    const dispatch: PreviewParseDispatchData = { request, ...(sourceBuffer ? { sourceBuffer } : {}) };
    try {
      previewWindow.webContents.postMessage(IPC.GENERATE_PREVIEW_PARSE_REQUEST, dispatch, [channel.port2]);
    } catch (error) {
      channel.port2.close();
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export interface PreviewWindowPlatform<WindowHandle> {
  create(): WindowHandle;
  load(window: WindowHandle, attempt: number): Promise<void>;
  destroy(window: WindowHandle): Promise<void>;
  senderId(window: WindowHandle): number;
  isDestroyed(window: WindowHandle): boolean;
  dispatch(window: WindowHandle, request: PreviewParseRequest, sourceBuffer?: ArrayBuffer): Promise<PreparedPreview>;
}

export function createPreviewWindowManager<WindowHandle>(
  platform: PreviewWindowPlatform<WindowHandle>,
  readinessTimeoutMs = 10_000,
) {
  let currentWindow: WindowHandle | null = null;
  let ready = false;
  let readiness: Deferred<WindowHandle> | null = null;
  let readinessTimer: ReturnType<typeof setTimeout> | null = null;
  let createAttempt = 0;
  let disposed = false;
  let destroying: Promise<void> | null = null;

  function clearReadinessTimer() {
    if (!readinessTimer) return;
    clearTimeout(readinessTimer);
    readinessTimer = null;
  }

  function destroyWindow(window: WindowHandle) {
    const operation = (destroying ?? Promise.resolve()).then(() => platform.destroy(window)).catch((error) => {
      console.warn('[PreviewWindow] Failed to destroy the owned parser window:', error);
    });
    destroying = operation;
    void operation.finally(() => {
      if (destroying === operation) destroying = null;
    });
    return operation;
  }

  function failCurrent(window: WindowHandle, error: unknown) {
    if (currentWindow !== window) return;
    currentWindow = null;
    ready = false;
    clearReadinessTimer();
    readiness?.reject(error);
    readiness = null;
    void destroyWindow(window);
  }

  function ensureReady(): Promise<WindowHandle> {
    if (disposed) return Promise.reject(new Error('Preview parser is shutting down'));
    if (destroying) return destroying.then(() => ensureReady());
    if (currentWindow && ready && !platform.isDestroyed(currentWindow)) {
      return Promise.resolve(currentWindow);
    }
    if (currentWindow && readiness) return readiness.promise;

    let window: WindowHandle;
    try {
      window = platform.create();
    } catch (error) {
      return Promise.reject(error);
    }
    currentWindow = window;
    ready = false;
    createAttempt += 1;
    const currentReadiness = deferred<WindowHandle>();
    readiness = currentReadiness;
    readinessTimer = setTimeout(() => {
      failCurrent(window, new Error('Preview parser readiness timed out'));
    }, readinessTimeoutMs);

    void platform.load(window, createAttempt).catch((error) => failCurrent(window, error));
    return currentReadiness.promise;
  }

  async function restart() {
    const oldWindow = currentWindow;
    currentWindow = null;
    ready = false;
    clearReadinessTimer();
    readiness?.reject(new Error('Preview parser runtime was replaced'));
    readiness = null;
    if (oldWindow) await destroyWindow(oldWindow);
    else if (destroying) await destroying;
  }

  return {
    ensureReady,
    async parse(request: PreviewParseRequest, sourceBuffer?: ArrayBuffer) {
      const owner = await ensureReady();
      if (currentWindow !== owner || !ready || platform.isDestroyed(owner)) {
        throw new Error('Preview parser runtime is no longer current');
      }
      return platform.dispatch(owner, request, sourceBuffer);
    },
    markReady(senderId: number) {
      const window = currentWindow;
      if (!window || platform.isDestroyed(window) || platform.senderId(window) !== senderId || !readiness) {
        return false;
      }
      ready = true;
      clearReadinessTimer();
      readiness.resolve(window);
      return true;
    },
    markLost(senderId: number, error = new Error('Preview parser renderer exited')) {
      const window = currentWindow;
      if (!window || platform.senderId(window) !== senderId) return false;
      failCurrent(window, error);
      return true;
    },
    getCurrentWindow() {
      return currentWindow;
    },
    async restart() {
      await restart();
    },
    async close() {
      disposed = true;
      await restart();
    },
  };
}
