import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("polytray", {
  // Folder management
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  getLastFolder: () => ipcRenderer.invoke("get-last-folder"),
  getLibraryFolders: () => ipcRenderer.invoke("get-library-folders"),
  removeLibraryFolder: (path) =>
    ipcRenderer.invoke("remove-library-folder", path),

  // Scanning
  scanFolder: (folderPath) => ipcRenderer.invoke("scan-folder", folderPath),
  rescan: () => ipcRenderer.invoke("rescan"),
  clearThumbnails: () => ipcRenderer.invoke("clear-thumbnails"),

  // File queries
  getFiles: (opts) => ipcRenderer.invoke("get-files", opts),
  getFileById: (id) => ipcRenderer.invoke("get-file-by-id", id),
  getStats: () => ipcRenderer.invoke("get-stats"),

  // 3D preview
  readFileBuffer: (filePath) =>
    ipcRenderer.invoke("read-file-buffer", filePath),

  // Thumbnails — served as base64 data URLs
  readThumbnail: (thumbnailPath) =>
    ipcRenderer.invoke("read-thumbnail", thumbnailPath),

  // File watching
  startWatching: (folderPath) =>
    ipcRenderer.invoke("start-watching", folderPath),
  stopWatching: () => ipcRenderer.invoke("stop-watching"),

  // Events (main → renderer)
  onScanProgress: (callback) => {
    ipcRenderer.on("scan-progress", (event, data) => callback(data));
  },
  onScanComplete: (callback) => {
    ipcRenderer.on("scan-complete", (event, data) => callback(data));
  },
  onFilesUpdated: (callback) => {
    ipcRenderer.on("files-updated", (event, data) => callback(data));
  },
  onFileIndexed: (callback) => {
    ipcRenderer.on("file-indexed", (event, data) => callback(data));
  },
  onThumbnailReady: (callback) => {
    ipcRenderer.on("thumbnail-ready", (event, data) => callback(data));
  },
  onThumbnailProgress: (callback) => {
    ipcRenderer.on("thumbnail-progress", (event, data) => callback(data));
  },

  // Thumbnail generation (main → renderer → main)
  onThumbnailRequest: (callback) => {
    ipcRenderer.on("generate-thumbnail-request", (event, data) =>
      callback(data),
    );
  },
  sendThumbnailResult: (result) => {
    ipcRenderer.send("thumbnail-generated", result);
  },
});
