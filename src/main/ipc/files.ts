/**
 * IPC handlers for file queries and data access.
 */
import { ipcMain, type IpcMain } from "electron";
import fs from "fs";
import * as unzipper from "unzipper";
import type { Database } from "better-sqlite3";
import { getDb } from "../database";
import {
  FileRecord,
  TotalRow,
  IPC,
  SortOptions,
  LibraryStats,
  LibraryQuery,
  LibraryPageResult,
} from "../../shared/types";
import { isPathContained } from "../pathContainment";
import { parseArchiveEntryPath } from "../../shared/archivePaths";
import {
  parseFileMetadataUpdate,
  parseLibraryQuery,
  parseFilePath,
  parseSortOptions,
} from "./runtimeValidation";
import { createFileIndexRepository } from "../fileIndexing";
import { getLibraryFiles, getLibraryPage } from "../libraryQueries";
import { getLibrarySummaryService } from "../librarySummary";
import { countIsolatedRequest } from "../testing/isolatedRequestCounters";
import { isRegularNonSymlinkFilePath } from "../localFileProtocol";

export interface FileHandlerReadiness {
  isScopeIndexReady(): boolean;
  ensureScopeIndexReady(): Promise<void>;
  runMutation?: <T>(operation: () => T | Promise<T>) => Promise<T>;
}

export function registerLibrarySummaryHandlers(
  summaryIpc: Pick<IpcMain, "handle"> = ipcMain,
  getSummaryDb: () => Database = getDb,
) {
  summaryIpc.handle(IPC.GET_DIRECTORIES, () => {
    countIsolatedRequest("directories");
    return getLibrarySummaryService(getSummaryDb()).getDirectories();
  });
  summaryIpc.handle(IPC.GET_STATS, (): LibraryStats => {
    countIsolatedRequest("stats");
    return getLibrarySummaryService(getSummaryDb()).getStats();
  });
}


async function readArchiveEntryBuffer(archivePath: string, entryPath: string) {
  const directory = await unzipper.Open.file(archivePath);
  const entry = directory.files.find(
    (file) => file.path === entryPath && file.type === "File",
  );
  if (!entry) {
    throw new Error("Archive entry not found");
  }
  return entry.buffer();
}

export function registerFileHandlers(readiness: FileHandlerReadiness) {
  registerLibrarySummaryHandlers();
  ipcMain.handle(IPC.GET_FILES, (event, opts: SortOptions = {}) => {
    const db = getDb();
    const parsedOptions = parseSortOptions(opts);
    if (readiness.isScopeIndexReady()) return getLibraryFiles(db, parsedOptions);
    const {
      sort = "name",
      order = "ASC",
      extension = null,
      search = "",
      limit = 200,
      offset = 0,
    } = parsedOptions;

    const validSorts: Record<string, string> = {
      name: "name",
      size: "size_bytes",
      date: "modified_at",
      vertices: "vertex_count",
      faces: "face_count",
    };
    const sortCol = validSorts[sort] ?? "name";
    const sortOrder = order === "DESC" ? "DESC" : "ASC";

    const where: string[] = [];
    const params: (string | number)[] = [];

    if (extension) {
      where.push("extension = ?");
      params.push(extension.toLowerCase());
    }
    if (search) {
      where.push("(name LIKE ? OR COALESCE(tags, '') LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    if (parsedOptions.folder) {
      const query = `SELECT * FROM files ${whereClause}`;
      const filtered = (db.prepare(query).all(...params) as FileRecord[])
        .filter((file) => isPathContained(parsedOptions.folder!, file.path));

      filtered.sort((a, b) => {
        const left = a[sortCol as keyof FileRecord];
        const right = b[sortCol as keyof FileRecord];

        let comparison = 0;
        if (sortCol === "name") {
          comparison = String(left).localeCompare(String(right), undefined, {
            sensitivity: "base",
          });
        } else if (left == null && right == null) {
          comparison = 0;
        } else if (left == null) {
          comparison = -1;
        } else if (right == null) {
          comparison = 1;
        } else if (left < right) {
          comparison = -1;
        } else if (left > right) {
          comparison = 1;
        }

        return sortOrder === "DESC" ? comparison * -1 : comparison;
      });

      return {
        files: filtered.slice(offset, offset + limit),
        total: filtered.length,
      };
    }

    const countQuery = `SELECT COUNT(*) as total FROM files ${whereClause}`;
    const countRow = db.prepare(countQuery).get(...params) as TotalRow;

    const collation = sortCol === "name" ? "COLLATE NOCASE " : "";
    const query = `SELECT * FROM files ${whereClause} ORDER BY ${sortCol} ${collation}${sortOrder} LIMIT ? OFFSET ?`;
    const files = db
      .prepare(query)
      .all(...params, limit, offset) as FileRecord[];

    return { files, total: countRow.total };
  });

  ipcMain.handle(IPC.GET_LIBRARY_PAGE, async (event, rawQuery): Promise<LibraryPageResult> => {
    countIsolatedRequest("libraryPages");
    const query: LibraryQuery = parseLibraryQuery(rawQuery);
    await readiness.ensureScopeIndexReady();
    return getLibraryPage(getDb(), query);
  });

  ipcMain.handle(IPC.GET_FILE_BY_ID, (event, id) => {
    const db = getDb();
    return db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  });

  ipcMain.handle(IPC.UPDATE_FILE_METADATA, async (event, payload) => {
    const update = () => {
    const db = getDb();
    const parsed = parseFileMetadataUpdate(payload);
    const repository = createFileIndexRepository(db);
    let expectedContentRevision = repository.getFileContentRevision(parsed.id);
    if (expectedContentRevision === null) throw new Error("File not found");

    for (let attempt = 0; attempt < 3; attempt++) {
      const result = repository.updateFileMetadata({
        fileId: parsed.id,
        expectedContentRevision,
        tags: parsed.tags,
        notes: parsed.notes,
      });
      if (result.status === "updated") return result.file;
      if (result.status === "missing") throw new Error("File not found");
      if (result.currentContentRevision === null) throw new Error("File not found");
      expectedContentRevision = result.currentContentRevision;
    }

    throw new Error("File changed while metadata was being updated");
    };
    return readiness.runMutation ? readiness.runMutation(update) : update();
  });

  ipcMain.handle(IPC.READ_FILE_BUFFER, async (event, filePath) => {
    const parsedFilePath = parseFilePath(filePath);
    const db = getDb();
    const record = db
      .prepare("SELECT id FROM files WHERE path = ?")
      .get(parsedFilePath);
    if (!record) {
      throw new Error("Access denied: File not in library");
    }

    const archiveEntry = parseArchiveEntryPath(parsedFilePath);
    if (!isRegularNonSymlinkFilePath(archiveEntry?.archivePath ?? parsedFilePath)) {
      throw new Error("Access denied: Indexed source is no longer a regular file");
    }
    const buffer = archiveEntry
      ? await readArchiveEntryBuffer(archiveEntry.archivePath, archiveEntry.entryPath)
      : await fs.promises.readFile(parsedFilePath);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  });

}
