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
} from "../shared/types";

function onChannel<T>(channel: string, callback: (data: T) => void) {
  const subscription = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, subscription);
  return () => ipcRenderer.removeListener(channel, subscription);
}

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
  scanFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC.SCAN_FOLDER, folderPath),
  rescan: () => ipcRenderer.invoke(IPC.RESCAN),
  clearThumbnails: () => ipcRenderer.invoke(IPC.CLEAR_THUMBNAILS),

  // File queries
  getFiles: (opts: SortOptions) => ipcRenderer.invoke(IPC.GET_FILES, opts),
  getFileById: (id: number) => ipcRenderer.invoke(IPC.GET_FILE_BY_ID, id),
  getStats: () => ipcRenderer.invoke(IPC.GET_STATS),
  startDrag: (filePath: string) =>
    ipcRenderer.send(IPC.ON_DRAG_START, filePath),
  showContextMenu: (filePath: string) =>
    ipcRenderer.send(IPC.SHOW_CONTEXT_MENU, filePath),

  // 3D preview
  readFileBuffer: (filePath: string) =>
    ipcRenderer.invoke(IPC.READ_FILE_BUFFER, filePath),

  // Thumbnails — served as base64 data URLs
  readThumbnail: (thumbnailPath: string) =>
    ipcRenderer.invoke(IPC.READ_THUMBNAIL, thumbnailPath),
  requestThumbnailGeneration: (filePath: string, ext: string) =>
    ipcRenderer.invoke(IPC.REQUEST_THUMBNAIL_GENERATION, filePath, ext),

  // File watching
  startWatching: (folderPath: string) =>
    ipcRenderer.invoke(IPC.START_WATCHING, folderPath),
  stopWatching: () => ipcRenderer.invoke(IPC.STOP_WATCHING),

  // Events (main → renderer)
  onScanProgress: (cb: (data: ScanProgressData) => void) =>
    onChannel<ScanProgressData>(IPC.SCAN_PROGRESS, cb),
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
});
