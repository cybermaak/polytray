import type { IpcRenderer, IpcRendererEvent } from 'electron';
import { IPC, type PreviewParseDispatchData, type PreviewParsePortData } from '../shared/types';
import type {
  PreparedPreview,
  PreviewParseCancelRequest,
  PreviewParsePortMessage,
  PreviewParseRequest,
} from '../shared/previewContracts';

type PreviewBridgeWindow = Pick<Window, 'addEventListener'>;
type PreviewCancelReason = PreviewParseCancelRequest['reason'];

interface PendingParse {
  resolve: (preview: PreparedPreview) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  port?: MessagePort;
}

interface PendingArchiveRead {
  resolve: (buffer: ArrayBuffer) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

function collectPreviewTransferables(preview: PreparedPreview): ArrayBuffer[] {
  const transferables = new Set<ArrayBuffer>();
  for (const mesh of preview.meshes) {
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      if (attribute.array.buffer instanceof ArrayBuffer) transferables.add(attribute.array.buffer);
    }
    if (mesh.geometry.index?.array.buffer instanceof ArrayBuffer) {
      transferables.add(mesh.geometry.index.array.buffer);
    }
  }
  return [...transferables];
}

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

function abortError(reason: string) {
  const error = new Error(`Preview parse ${reason}`);
  error.name = 'AbortError';
  return error;
}

export function createPreviewBridge(
  ipcRenderer: Pick<IpcRenderer, 'on' | 'invoke' | 'send'>,
  bridgeWindow: PreviewBridgeWindow,
) {
  const pendingParses = new Map<string, PendingParse>();
  const pendingArchiveReads = new Map<string, PendingArchiveRead>();
  const hiddenPorts = new Map<string, MessagePort>();
  const hiddenParseListeners = new Set<(data: PreviewParseDispatchData) => void>();

  function settleParse(requestId: string, callback: (pending: PendingParse) => void) {
    const pending = pendingParses.get(requestId);
    if (!pending) return;
    pendingParses.delete(requestId);
    clearTimeout(pending.timeoutId);
    pending.port?.close();
    callback(pending);
  }

  function settleArchiveRead(requestId: string, callback: (pending: PendingArchiveRead) => void) {
    const pending = pendingArchiveReads.get(requestId);
    if (!pending) return;
    pendingArchiveReads.delete(requestId);
    clearTimeout(pending.timeoutId);
    callback(pending);
  }

  function cancelPreviewParse(requestId: string, reason: PreviewCancelReason) {
    ipcRenderer.send(IPC.CANCEL_PREVIEW_PARSE, { requestId, reason } satisfies PreviewParseCancelRequest);
    settleParse(requestId, (pending) => pending.reject(abortError(reason)));
    settleArchiveRead(requestId, (pending) => pending.reject(abortError(reason)));
  }

  ipcRenderer.on(IPC.PREVIEW_PARSE_PORT, (event: IpcRendererEvent, data: PreviewParsePortData) => {
    const pending = pendingParses.get(data.requestId);
    const [port] = event.ports;
    if (!pending || !port) {
      port?.close();
      if (pending && !port) {
        settleParse(data.requestId, (current) => current.reject(new Error('Preview parse response port was not delivered')));
      }
      return;
    }
    pending.port = port;
    port.onmessage = (messageEvent) => {
      const payload = messageEvent.data as PreviewParsePortMessage;
      if (!payload || payload.requestId !== data.requestId) return;
      if (payload.type === 'done') {
        settleParse(data.requestId, (current) => current.resolve(payload.preview));
      } else if (payload.type === 'cancelled') {
        settleParse(data.requestId, (current) => current.reject(abortError(payload.reason)));
      } else {
        settleParse(data.requestId, (current) => current.reject(new Error(payload.error)));
      }
    };
    port.onmessageerror = () => {
      settleParse(data.requestId, (current) => current.reject(new Error('Preview parse response could not be read')));
    };
    port.start();
  });

  ipcRenderer.on(IPC.GENERATE_PREVIEW_PARSE_REQUEST, (event: IpcRendererEvent, data: PreviewParseDispatchData) => {
    const [port] = event.ports;
    if (!port || !data?.request?.requestId) {
      port?.close();
      return;
    }
    const prior = hiddenPorts.get(data.request.requestId);
    prior?.close();
    hiddenPorts.set(data.request.requestId, port);
    port.start();
    for (const listener of [...hiddenParseListeners]) listener(data);
  });

  bridgeWindow.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const payload = event.data as
      | { type: '__polytray-preview-parse-result'; requestId: string; preview: PreparedPreview }
      | { type: '__polytray-preview-parse-error'; requestId: string; error: string }
      | undefined;
    if (!payload || (payload.type !== '__polytray-preview-parse-result' && payload.type !== '__polytray-preview-parse-error')) return;
    const port = hiddenPorts.get(payload.requestId);
    if (!port) return;
    hiddenPorts.delete(payload.requestId);
    try {
      if (payload.type === '__polytray-preview-parse-result') {
        port.postMessage(
          { requestId: payload.requestId, type: 'done', preview: payload.preview } satisfies PreviewParsePortMessage,
          collectPreviewTransferables(payload.preview),
        );
      } else {
        port.postMessage({ requestId: payload.requestId, type: 'error', error: payload.error } satisfies PreviewParsePortMessage);
      }
    } catch (error) {
      console.warn('[PreviewBridge] Could not deliver hidden parse result:', error);
    } finally {
      port.close();
    }
  });

  return {
    requestPreviewParse(request: PreviewParseRequest): Promise<PreparedPreview> {
      if (pendingParses.has(request.requestId) || pendingArchiveReads.has(request.requestId)) {
        return Promise.reject(new Error('Duplicate preview request ID'));
      }
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          cancelPreviewParse(request.requestId, 'timeout');
        }, 120_000);
        pendingParses.set(request.requestId, { resolve, reject, timeoutId });
        ipcRenderer.invoke(IPC.REQUEST_PREVIEW_PARSE, request).catch((error) => {
          settleParse(request.requestId, (pending) => pending.reject(toError(error)));
        });
      });
    },
    cancelPreviewParse,
    readPreviewArchiveBuffer(request: PreviewParseRequest): Promise<ArrayBuffer> {
      if (pendingParses.has(request.requestId) || pendingArchiveReads.has(request.requestId)) {
        return Promise.reject(new Error('Duplicate preview request ID'));
      }
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          cancelPreviewParse(request.requestId, 'timeout');
        }, 120_000);
        pendingArchiveReads.set(request.requestId, { resolve, reject, timeoutId });
        ipcRenderer.invoke(IPC.READ_PREVIEW_ARCHIVE_BUFFER, request).then(
          (buffer: ArrayBuffer) => settleArchiveRead(request.requestId, (pending) => pending.resolve(buffer)),
          (error) => settleArchiveRead(request.requestId, (pending) => pending.reject(toError(error))),
        );
      });
    },
    markPreviewRuntimeReady() {
      ipcRenderer.send(IPC.PREVIEW_RUNTIME_READY);
    },
    onPreviewParseRequest(callback: (data: PreviewParseDispatchData) => void) {
      hiddenParseListeners.add(callback);
      return () => hiddenParseListeners.delete(callback);
    },
  };
}
