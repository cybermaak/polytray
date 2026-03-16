import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import {
  IPC,
  ScanProgressData,
  ScanCompleteData,
  FilesUpdatedData,
  FileIndexedData,
  ThumbnailReadyData,
  ThumbnailProgressData,
  ThumbnailRequestData,
  ThumbnailResultData,
  SortOptions,
  PreviewParseRequestData,
  PreviewParsePortData,
  PreviewMetricData,
  RuntimeSettingsData,
  SerializedMesh,
  UpdateFileMetadataData,
} from "../shared/types";

function onChannel<T>(channel: string, callback: (data: T) => void) {
  const subscription = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, subscription);
  return () => ipcRenderer.removeListener(channel, subscription);
}

const pendingPreviewParses = new Map<
  string,
  {
    resolve: (meshes: SerializedMesh[]) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();

const pendingHiddenPreviewPorts = new Map<string, MessagePort>();
let hiddenPreviewParseListener:
  | ((data: PreviewParseRequestData) => void)
  | null = null;

function collectMeshTransferables(meshes: SerializedMesh[]): ArrayBuffer[] {
  const transferables: ArrayBuffer[] = [];

  for (const mesh of meshes) {
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      if (attribute.array.buffer instanceof ArrayBuffer) {
        transferables.push(attribute.array.buffer);
      }
    }

    if (mesh.geometry.index?.array.buffer instanceof ArrayBuffer) {
      transferables.push(mesh.geometry.index.array.buffer);
    }
  }

  return transferables;
}

ipcRenderer.on(IPC.PREVIEW_PARSE_PORT, (event, data: PreviewParsePortData) => {
  const pending = pendingPreviewParses.get(data.requestId);
  if (!pending) return;

  const [port] = event.ports;
  if (!port) {
    clearTimeout(pending.timeoutId);
    pendingPreviewParses.delete(data.requestId);
    pending.reject(new Error("Preview parse transport was not delivered"));
    return;
  }

  const finalize = () => {
    clearTimeout(pending.timeoutId);
    pendingPreviewParses.delete(data.requestId);
    port.close();
  };

  port.onmessage = (messageEvent) => {
    const payload = messageEvent.data as
      | { type: "done"; meshes: SerializedMesh[] }
      | { type: "error"; error: string };

    if (payload.type === "done") {
      finalize();
      pending.resolve(payload.meshes);
      return;
    }

    finalize();
    pending.reject(new Error(payload.error));
  };

  port.start();
});

ipcRenderer.on(IPC.GENERATE_PREVIEW_PARSE_REQUEST, (event, data: PreviewParseRequestData) => {
  const [port] = event.ports;
  if (!port) {
    return;
  }

  pendingHiddenPreviewPorts.set(data.requestId, port);
  port.start();
  hiddenPreviewParseListener?.(data);
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const payload = event.data as
    | {
      type: "__polytray-preview-parse-result";
      requestId: string;
      meshes: SerializedMesh[];
    }
    | {
      type: "__polytray-preview-parse-error";
      requestId: string;
      error: string;
    }
    | undefined;

  if (!payload || (payload.type !== "__polytray-preview-parse-result" && payload.type !== "__polytray-preview-parse-error")) {
    return;
  }

  const port = pendingHiddenPreviewPorts.get(payload.requestId);
  if (!port) {
    return;
  }

  pendingHiddenPreviewPorts.delete(payload.requestId);

  if (payload.type === "__polytray-preview-parse-result") {
    const transferables = collectMeshTransferables(payload.meshes);
    port.postMessage(
      { type: "done", meshes: payload.meshes },
      transferables,
    );
  } else {
    port.postMessage({
      type: "error",
      error: payload.error,
    });
  }

  port.close();
});

// ── Exposed API ─────────────────────────────────────────────────────

contextBridge.exposeInMainWorld("polytray", {
  // Folder management
  selectFolder: () => ipcRenderer.invoke(IPC.SELECT_FOLDER),
  getLastFolder: () => ipcRenderer.invoke(IPC.GET_LAST_FOLDER),
  getLibraryFolders: () => ipcRenderer.invoke(IPC.GET_LIBRARY_FOLDERS),
  getDirectories: () => ipcRenderer.invoke(IPC.GET_DIRECTORIES),
  removeLibraryFolder: (path: string) =>
    ipcRenderer.invoke(IPC.REMOVE_LIBRARY_FOLDER, path),

  // Scanning
  scanFolder: (folderPath: string, settings: RuntimeSettingsData) =>
    ipcRenderer.invoke(IPC.SCAN_FOLDER, folderPath, settings),
  rescan: () => ipcRenderer.invoke(IPC.RESCAN),
  clearThumbnails: (settings: RuntimeSettingsData) =>
    ipcRenderer.invoke(IPC.CLEAR_THUMBNAILS, settings),
  refreshFolderThumbnails: (folderPath: string, settings: RuntimeSettingsData) =>
    ipcRenderer.invoke(IPC.REFRESH_FOLDER_THUMBNAILS, folderPath, settings),

  // File queries
  getFiles: (opts: SortOptions) => ipcRenderer.invoke(IPC.GET_FILES, opts),
  getFileById: (id: number) => ipcRenderer.invoke(IPC.GET_FILE_BY_ID, id),
  updateFileMetadata: (payload: UpdateFileMetadataData) =>
    ipcRenderer.invoke(IPC.UPDATE_FILE_METADATA, payload),
  getStats: () => ipcRenderer.invoke(IPC.GET_STATS),
  startDrag: (filePath: string) =>
    ipcRenderer.send(IPC.ON_DRAG_START, filePath),
  showContextMenu: (filePath: string) =>
    ipcRenderer.send(IPC.SHOW_CONTEXT_MENU, filePath),
  showFolderContextMenu: (folderPath: string) =>
    ipcRenderer.send(IPC.SHOW_FOLDER_CONTEXT_MENU, folderPath),

  // 3D preview
  readFileBuffer: (filePath: string) =>
    ipcRenderer.invoke(IPC.READ_FILE_BUFFER, filePath),

  // Thumbnails — served as base64 data URLs
  readThumbnail: (thumbnailPath: string) =>
    ipcRenderer.invoke(IPC.READ_THUMBNAIL, thumbnailPath),
  requestThumbnailGeneration: (
    filePath: string,
    ext: string,
    settings?: RuntimeSettingsData,
  ) => ipcRenderer.invoke(IPC.REQUEST_THUMBNAIL_GENERATION, filePath, ext, settings),
  requestPreviewParse: (filePath: string, ext: string) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise<SerializedMesh[]>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingPreviewParses.delete(requestId);
        reject(new Error("Preview parse timed out"));
      }, 120000);

      pendingPreviewParses.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });

      ipcRenderer
        .invoke(IPC.REQUEST_PREVIEW_PARSE, {
          requestId,
          filePath,
          ext,
        } satisfies PreviewParseRequestData)
        .catch((error) => {
          clearTimeout(timeoutId);
          pendingPreviewParses.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  },
  emitPreviewMetric: (metric: PreviewMetricData) => {
    ipcRenderer.send(IPC.PREVIEW_METRIC, metric);
  },

  // File watching
  startWatching: (folderPaths: string[], settings: RuntimeSettingsData) =>
    ipcRenderer.invoke(IPC.START_WATCHING, folderPaths, settings),
  stopWatching: () => ipcRenderer.invoke(IPC.STOP_WATCHING),

  // ── Event Listeners (return generic unsubscribe functions) ──────────

  onFolderAction: (
    callback: (action: "refresh" | "rescan", folderPath: string) => void,
  ) => {
    const refreshHandler = (_e: Electron.IpcRendererEvent, folder: string) => callback("refresh", folder);
    const rescanHandler = (_e: Electron.IpcRendererEvent, folder: string) => callback("rescan", folder);
    ipcRenderer.on("trigger-refresh-folder", refreshHandler);
    ipcRenderer.on("trigger-rescan-folder", rescanHandler);
    return () => {
      ipcRenderer.removeListener("trigger-refresh-folder", refreshHandler);
      ipcRenderer.removeListener("trigger-rescan-folder", rescanHandler);
    };
  },

  onScanProgress: (callback: (data: ScanProgressData) => void) =>
    onChannel<ScanProgressData>(IPC.SCAN_PROGRESS, callback),
  onScanComplete: (cb: (data: ScanCompleteData) => void) =>
    onChannel<ScanCompleteData>(IPC.SCAN_COMPLETE, cb),
  onFilesUpdated: (cb: (data: FilesUpdatedData) => void) =>
    onChannel<FilesUpdatedData>(IPC.FILES_UPDATED, cb),
  onFileIndexed: (cb: (data: FileIndexedData) => void) =>
    onChannel<FileIndexedData>(IPC.FILE_INDEXED, cb),
  onThumbnailReady: (cb: (data: ThumbnailReadyData) => void) =>
    onChannel<ThumbnailReadyData>(IPC.THUMBNAIL_READY, cb),
  onThumbnailProgress: (cb: (data: ThumbnailProgressData) => void) =>
    onChannel<ThumbnailProgressData>(IPC.THUMBNAIL_PROGRESS, cb),

  // Thumbnail generation (main → renderer → main)
  onThumbnailRequest: (cb: (data: ThumbnailRequestData) => void) =>
    onChannel<ThumbnailRequestData>(IPC.GENERATE_THUMBNAIL_REQUEST, cb),
  sendThumbnailResult: (result: ThumbnailResultData) => {
    ipcRenderer.send(IPC.THUMBNAIL_GENERATED, result);
  },
  onPreviewParseRequest: (cb: (data: PreviewParseRequestData) => void) => {
    hiddenPreviewParseListener = cb;
    return () => {
      if (hiddenPreviewParseListener === cb) {
        hiddenPreviewParseListener = null;
      }
    };
  },
});
