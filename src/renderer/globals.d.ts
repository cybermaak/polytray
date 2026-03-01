/**
 * globals.d.ts — Window type augmentation for the polytray preload API.
 */

interface PolytrayAPI {
  selectFolder: () => Promise<string | null>;
  getLastFolder: () => Promise<string | null>;
  getLibraryFolders: () => Promise<string[]>;
  removeLibraryFolder: (path: string) => Promise<string[]>;

  scanFolder: (folderPath: string) => Promise<void>;
  rescan: () => Promise<void>;
  clearThumbnails: () => Promise<void>;

  getFiles: (opts: any) => Promise<{ files: any[]; total: number }>;
  getFileById: (id: number) => Promise<any>;
  getStats: () => Promise<{
    total: number;
    stl: number;
    obj: number;
    threemf: number;
    totalSize: number;
  }>;

  readFileBuffer: (filePath: string) => Promise<ArrayBuffer>;
  readThumbnail: (thumbnailPath: string) => Promise<string | null>;

  startWatching: (folderPath: string) => Promise<void>;
  stopWatching: () => Promise<void>;

  onScanProgress: (callback: (data: any) => void) => void;
  onScanComplete: (callback: (data: any) => void) => void;
  onFilesUpdated: (callback: (data: any) => void) => void;
  onFileIndexed: (callback: (data: any) => void) => void;
  onThumbnailReady: (callback: (data: any) => void) => void;
  onThumbnailProgress: (callback: (data: any) => void) => void;

  onThumbnailRequest: (callback: (data: any) => void) => void;
  sendThumbnailResult: (result: any) => void;
}

declare global {
  interface Window {
    polytray: PolytrayAPI;
  }
}

export {};
