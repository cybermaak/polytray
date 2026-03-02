import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("polytray", {
  // Folder management
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  getLastFolder: () => ipcRenderer.invoke("get-last-folder"),
  getLibraryFolders: () => ipcRenderer.invoke("get-library-folders"),
  removeLibraryFolder: (path: string) =>
    ipcRenderer.invoke("remove-library-folder", path),

  // Scanning
  scanFolder: (folderPath: string) =>
    ipcRenderer.invoke("scan-folder", folderPath),
  rescan: () => ipcRenderer.invoke("rescan"),
  clearThumbnails: () => ipcRenderer.invoke("clear-thumbnails"),

  // File queries
  getFiles: (opts: any) => ipcRenderer.invoke("get-files", opts),
  getFileById: (id: number) => ipcRenderer.invoke("get-file-by-id", id),
  getStats: () => ipcRenderer.invoke("get-stats"),

  // 3D preview
  readFileBuffer: (filePath: string) =>
    ipcRenderer.invoke("read-file-buffer", filePath),

  // Thumbnails — served as base64 data URLs
  readThumbnail: (thumbnailPath: string) =>
    ipcRenderer.invoke("read-thumbnail", thumbnailPath),
  requestThumbnailGeneration: (filePath: string, ext: string) =>
    ipcRenderer.invoke("request-thumbnail-generation", filePath, ext),

  // File watching
  startWatching: (folderPath: string) =>
    ipcRenderer.invoke("start-watching", folderPath),
  stopWatching: () => ipcRenderer.invoke("stop-watching"),

  // Events (main → renderer)
  onScanProgress: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on("scan-progress", subscription);
    return () => ipcRenderer.removeListener("scan-progress", subscription);
  },
  onScanComplete: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on("scan-complete", subscription);
    return () => ipcRenderer.removeListener("scan-complete", subscription);
  },
  onFilesUpdated: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on("files-updated", subscription);
    return () => ipcRenderer.removeListener("files-updated", subscription);
  },
  onFileIndexed: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on("file-indexed", subscription);
    return () => ipcRenderer.removeListener("file-indexed", subscription);
  },
  onThumbnailReady: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on("thumbnail-ready", subscription);
    return () => ipcRenderer.removeListener("thumbnail-ready", subscription);
  },
  onThumbnailProgress: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on("thumbnail-progress", subscription);
    return () => ipcRenderer.removeListener("thumbnail-progress", subscription);
  },

  // Thumbnail generation (main → renderer → main)
  onThumbnailRequest: (callback: (data: any) => void) => {
    const subscription = (event: any, data: any) => callback(data);
    ipcRenderer.on("generate-thumbnail-request", subscription);
    return () =>
      ipcRenderer.removeListener("generate-thumbnail-request", subscription);
  },
  sendThumbnailResult: (result: any) => {
    ipcRenderer.send("thumbnail-generated", result);
  },
});
