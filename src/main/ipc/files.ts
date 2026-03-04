/**
 * IPC handlers for file queries and data access.
 */
import { ipcMain } from "electron";
import fs from "fs";
import { getDb } from "../database";
import { FileRecord, CountRow, TotalRow, IPC } from "../../shared/types";

export function registerFileHandlers() {
  ipcMain.handle(IPC.GET_FILES, (event, opts = {}) => {
    const db = getDb();
    const {
      sort = "name",
      order = "ASC",
      extension = null,
      search = "",
      limit = 200,
      offset = 0,
    } = opts;

    const validSorts: Record<string, string> = {
      name: "name",
      size: "size_bytes",
      date: "modified_at",
      vertices: "vertex_count",
      faces: "face_count",
    };
    const sortCol = validSorts[sort] ?? "name";
    const sortOrder = order === "DESC" ? "DESC" : "ASC";

    let where: string[] = [];
    let params: (string | number)[] = [];

    if (extension) {
      where.push("extension = ?");
      params.push(extension.toLowerCase());
    }
    if (search) {
      where.push("name LIKE ?");
      params.push(`%${search}%`);
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const countQuery = `SELECT COUNT(*) as total FROM files ${whereClause}`;
    const countRow = db.prepare(countQuery).get(...params) as TotalRow;

    const collation = sortCol === "name" ? "COLLATE NOCASE " : "";
    const query = `SELECT * FROM files ${whereClause} ORDER BY ${sortCol} ${collation}${sortOrder} LIMIT ? OFFSET ?`;
    const files = db
      .prepare(query)
      .all(...params, limit, offset) as FileRecord[];

    return { files, total: countRow.total };
  });

  ipcMain.handle(IPC.GET_FILE_BY_ID, (event, id) => {
    const db = getDb();
    return db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  });

  ipcMain.handle(IPC.READ_FILE_BUFFER, async (event, filePath) => {
    // Validate that the file is part of the indexed library
    const db = getDb();
    const record = db
      .prepare("SELECT id FROM files WHERE path = ?")
      .get(filePath);
    if (!record) {
      throw new Error("Access denied: File not in library");
    }

    const buffer = await fs.promises.readFile(filePath);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  });

  ipcMain.handle(IPC.GET_STATS, () => {
    const db = getDb();
    const total = (
      db.prepare("SELECT COUNT(*) as count FROM files").get() as CountRow
    ).count;
    const stl = (
      db
        .prepare("SELECT COUNT(*) as count FROM files WHERE extension = 'stl'")
        .get() as CountRow
    ).count;
    const obj = (
      db
        .prepare("SELECT COUNT(*) as count FROM files WHERE extension = 'obj'")
        .get() as CountRow
    ).count;
    const threemf = (
      db
        .prepare("SELECT COUNT(*) as count FROM files WHERE extension = '3mf'")
        .get() as CountRow
    ).count;
    const totalSize = (
      db
        .prepare("SELECT COALESCE(SUM(size_bytes), 0) as total FROM files")
        .get() as TotalRow
    ).total;
    return { total, stl, obj, threemf, totalSize };
  });
}
