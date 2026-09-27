import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { createPreviewBridge } from "./previewBridge";
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
  PreviewMetricData,
  MainWindowVisibilityData,
  RuntimeSettingsData,
  UpdateFileMetadataData,
  IndexMutationResult,
} from "../shared/types";

function onChannel<T>(channel: string, callback: (data: T) => void) {
  const subscription = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, subscription);
  return () => ipcRenderer.removeListener(channel, subscription);
}

let latestMainWindowVisibility: MainWindowVisibilityData | null = null;
const mainWindowVisibilityListeners = new Set<(data: MainWindowVisibilityData) => void>();

ipcRenderer.on(IPC.MAIN_WINDOW_VISIBILITY, (_event, value: MainWindowVisibilityData) => {
  if (!value || typeof value.visible !== "boolean" || !Number.isSafeInteger(value.revision)) return;
  if (latestMainWindowVisibility && value.revision <= latestMainWindowVisibility.revision) return;
  latestMainWindowVisibility = value;
  for (const listener of [...mainWindowVisibilityListeners]) listener(value);
});

function onMainWindowVisibility(callback: (data: MainWindowVisibilityData) => void) {
  mainWindowVisibilityListeners.add(callback);
  if (latestMainWindowVisibility) callback(latestMainWindowVisibility);
  return () => mainWindowVisibilityListeners.delete(callback);
}

const previewBridge = createPreviewBridge(ipcRenderer, window);

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
  showArchiveContextMenu: (path: string, isSummary: boolean) =>
    ipcRenderer.send(IPC.SHOW_ARCHIVE_CONTEXT_MENU, path, isSummary),

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
  requestPreviewParse: previewBridge.requestPreviewParse,
  cancelPreviewParse: previewBridge.cancelPreviewParse,
  readPreviewArchiveBuffer: previewBridge.readPreviewArchiveBuffer,
  markPreviewRuntimeReady: previewBridge.markPreviewRuntimeReady,
  ...(process.env.POLYTRAY_ISOLATED_TEST === "1"
    ? { __previewParsePendingCounts: previewBridge.getPendingCounts }
    : {}),
  emitPreviewMetric: (metric: PreviewMetricData) => {
    ipcRenderer.send(IPC.PREVIEW_METRIC, metric);
  },

  // File watching
  startWatching: (folderPaths: string[], settings: RuntimeSettingsData) =>
    ipcRenderer.invoke(IPC.START_WATCHING, folderPaths, settings),
  stopWatching: () => ipcRenderer.invoke(IPC.STOP_WATCHING),
  getMainWindowVisibility: () =>
    ipcRenderer.invoke(IPC.GET_MAIN_WINDOW_VISIBILITY) as Promise<MainWindowVisibilityData>,
  onMainWindowVisibility,

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

  onArchiveOpen: (callback: (archiveVirtualPath: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on("trigger-open-archive", handler);
    return () => ipcRenderer.removeListener("trigger-open-archive", handler);
  },

  onScanProgress: (callback: (data: ScanProgressData) => void) =>
    onChannel<ScanProgressData>(IPC.SCAN_PROGRESS, callback),
  onScanComplete: (cb: (data: ScanCompleteData) => void) =>
    onChannel<ScanCompleteData>(IPC.SCAN_COMPLETE, cb),
  onFilesUpdated: (cb: (data: FilesUpdatedData) => void) =>
    onChannel<FilesUpdatedData>(IPC.FILES_UPDATED, cb),
  onLibraryChanged: (cb: (data: IndexMutationResult) => void) =>
    onChannel<IndexMutationResult>(IPC.LIBRARY_CHANGED, cb),
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
  onPreviewParseRequest: previewBridge.onPreviewParseRequest,
});
