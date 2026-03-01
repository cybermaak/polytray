export interface FileRecord {
  id: number;
  path: string;
  name: string;
  extension: string;
  directory: string;
  size_bytes: number;
  modified_at: number;
  vertex_count: number;
  face_count: number;
  thumbnail: string | null;
  indexed_at: number;
}

export interface AppSettings {
  library_folders: string[];
  last_folder: string | null;
  lightMode: boolean;
  gridSize: "small" | "medium" | "large";
  autoRescan: boolean;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface CountRow {
  count: number;
}

export interface TotalRow {
  total: number;
}

export interface ScannedFile {
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime: number;
}

export const SUPPORTED_EXTENSIONS = ["stl", "obj", "3mf"];
