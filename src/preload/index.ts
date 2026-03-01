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

  // File watching
  startWatching: (folderPath: string) =>
    ipcRenderer.invoke("start-watching", folderPath),
  stopWatching: () => ipcRenderer.invoke("stop-watching"),

  // Events (main → renderer)
  onScanProgress: (callback: (data: any) => void) => {
    ipcRenderer.on("scan-progress", (event, data) => callback(data));
  },
  onScanComplete: (callback: (data: any) => void) => {
    ipcRenderer.on("scan-complete", (event, data) => callback(data));
  },
  onFilesUpdated: (callback: (data: any) => void) => {
    ipcRenderer.on("files-updated", (event, data) => callback(data));
  },
  onFileIndexed: (callback: (data: any) => void) => {
    ipcRenderer.on("file-indexed", (event, data) => callback(data));
  },
  onThumbnailReady: (callback: (data: any) => void) => {
    ipcRenderer.on("thumbnail-ready", (event, data) => callback(data));
  },
  onThumbnailProgress: (callback: (data: any) => void) => {
    ipcRenderer.on("thumbnail-progress", (event, data) => callback(data));
  },

  // Thumbnail generation (main → renderer → main)
  onThumbnailRequest: (callback: (data: any) => void) => {
    ipcRenderer.on("generate-thumbnail-request", (event, data) =>
      callback(data),
    );
  },
  sendThumbnailResult: (result: any) => {
    ipcRenderer.send("thumbnail-generated", result);
  },
});
