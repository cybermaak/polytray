import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/types";

contextBridge.exposeInMainWorld("polytray", {
  // Folder management
  selectFolder: () => ipcRenderer.invoke(IPC.SELECT_FOLDER),
  getLastFolder: () => ipcRenderer.invoke(IPC.GET_LAST_FOLDER),
  getLibraryFolders: () => ipcRenderer.invoke(IPC.GET_LIBRARY_FOLDERS),
  removeLibraryFolder: (path: string) =>
    ipcRenderer.invoke(IPC.REMOVE_LIBRARY_FOLDER, path),

  // Scanning
  scanFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC.SCAN_FOLDER, folderPath),
  rescan: () => ipcRenderer.invoke(IPC.RESCAN),
  clearThumbnails: () => ipcRenderer.invoke(IPC.CLEAR_THUMBNAILS),

  // File queries
  getFiles: (opts: any) => ipcRenderer.invoke(IPC.GET_FILES, opts),
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
  onScanProgress: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.SCAN_PROGRESS, subscription);
    return () => ipcRenderer.removeListener(IPC.SCAN_PROGRESS, subscription);
  },
  onScanComplete: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.SCAN_COMPLETE, subscription);
    return () => ipcRenderer.removeListener(IPC.SCAN_COMPLETE, subscription);
  },
  onFilesUpdated: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.FILES_UPDATED, subscription);
    return () => ipcRenderer.removeListener(IPC.FILES_UPDATED, subscription);
  },
  onFileIndexed: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.FILE_INDEXED, subscription);
    return () => ipcRenderer.removeListener(IPC.FILE_INDEXED, subscription);
  },
  onThumbnailReady: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.THUMBNAIL_READY, subscription);
    return () => ipcRenderer.removeListener(IPC.THUMBNAIL_READY, subscription);
  },
  onThumbnailProgress: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.THUMBNAIL_PROGRESS, subscription);
    return () =>
      ipcRenderer.removeListener(IPC.THUMBNAIL_PROGRESS, subscription);
  },

  // Thumbnail generation (main → renderer → main)
  onThumbnailRequest: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.GENERATE_THUMBNAIL_REQUEST, subscription);
    return () =>
      ipcRenderer.removeListener(IPC.GENERATE_THUMBNAIL_REQUEST, subscription);
  },
  sendThumbnailResult: (result: any) => {
    ipcRenderer.send(IPC.THUMBNAIL_GENERATED, result);
  },
});
