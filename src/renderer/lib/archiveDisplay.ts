import type { FileRecord } from "../../shared/types";
import {
  ARCHIVE_ENTRY_SEPARATOR,
  parseArchiveEntryPath,
} from "../../shared/archivePaths";

export interface ArchiveSummaryRecord {
  kind: "archive-summary";
  id: number;
  path: string;
  name: string;
  extension: "zip";
  directory: string;
  size_bytes: number;
  modified_at: number;
  vertex_count: number;
  face_count: number;
  thumbnail: null;
  thumbnail_failed: number;
  indexed_at: number;
  dimensions?: null;
  notes?: null;
  tags?: null;
  entries: FileRecord[];
}

export type DisplayFileRecord = FileRecord | ArchiveSummaryRecord;

function basename(filePath: string) {
  const normalized = filePath.replace(/\\+/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function dirname(filePath: string) {
  const normalized = filePath.replace(/\\+/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return ".";
  }
  return normalized.slice(0, lastSlash);
}

export function isArchiveSummaryRecord(
  file: DisplayFileRecord,
): file is ArchiveSummaryRecord {
  return "kind" in file && file.kind === "archive-summary";
}

export function getArchiveRootVirtualPath(archivePath: string) {
  return `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}`;
}

export function formatArchiveFolderLabel(folderPath: string | null) {
  if (!folderPath || !folderPath.includes(ARCHIVE_ENTRY_SEPARATOR)) {
    return folderPath;
  }

  const archiveEntry = parseArchiveEntryPath(
    folderPath.endsWith(ARCHIVE_ENTRY_SEPARATOR)
      ? `${folderPath}__root__`
      : folderPath,
  );

  if (!archiveEntry) {
    return folderPath;
  }

  if (archiveEntry.entryPath === "__root__") {
    return basename(archiveEntry.archivePath);
  }

  const cleanedEntryPath = archiveEntry.entryPath.replace(/\/__root__$/, "");
  return cleanedEntryPath.split("/").filter(Boolean).pop() || basename(archiveEntry.archivePath);
}

function createArchiveSummaryId(archivePath: string) {
  let hash = 0;
  for (let i = 0; i < archivePath.length; i++) {
    hash = (hash * 31 + archivePath.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash || 1);
  return positive * -1;
}

function createArchiveSummary(entries: FileRecord[]): ArchiveSummaryRecord {
  const archivePath = parseArchiveEntryPath(entries[0].path)!.archivePath;
  return {
    kind: "archive-summary",
    id: createArchiveSummaryId(archivePath),
    path: archivePath,
    name: basename(archivePath),
    extension: "zip",
    directory: dirname(archivePath),
    size_bytes: entries.reduce((sum, entry) => sum + entry.size_bytes, 0),
    modified_at: Math.max(...entries.map((entry) => entry.modified_at)),
    vertex_count: entries.reduce((sum, entry) => sum + (entry.vertex_count || 0), 0),
    face_count: entries.reduce((sum, entry) => sum + (entry.face_count || 0), 0),
    thumbnail: null,
    thumbnail_failed: 0,
    indexed_at: Math.max(...entries.map((entry) => entry.indexed_at || 0)),
    dimensions: null,
    notes: null,
    tags: null,
    entries,
  };
}

export function collapseArchiveEntriesForDisplay(
  files: FileRecord[],
  options: {
    activeFolder: string | null;
    search: string;
    hasActiveCollection: boolean;
  },
): DisplayFileRecord[] {
  if (options.search.trim() || options.hasActiveCollection) {
    return files;
  }

  if (options.activeFolder && options.activeFolder.includes(ARCHIVE_ENTRY_SEPARATOR)) {
    return files;
  }

  const grouped = new Map<string, FileRecord[]>();
  const result: DisplayFileRecord[] = [];

  for (const file of files) {
    const archiveEntry = parseArchiveEntryPath(file.path);
    if (!archiveEntry) {
      result.push(file);
      continue;
    }

    const bucket = grouped.get(archiveEntry.archivePath) || [];
    bucket.push(file);
    grouped.set(archiveEntry.archivePath, bucket);
  }

  const seenArchives = new Set<string>();
  for (const file of files) {
    const archiveEntry = parseArchiveEntryPath(file.path);
    if (!archiveEntry) {
      continue;
    }
    if (seenArchives.has(archiveEntry.archivePath)) {
      continue;
    }
    seenArchives.add(archiveEntry.archivePath);
    result.push(createArchiveSummary(grouped.get(archiveEntry.archivePath)!));
  }

  return result;
}
