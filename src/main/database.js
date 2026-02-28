import Database from "better-sqlite3";
import { app } from "electron";
import path from "path";
import fs from "fs";

let db = null;

export function initDatabase() {
  const dbDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, "polytray.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent reads
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      path          TEXT    UNIQUE NOT NULL,
      name          TEXT    NOT NULL,
      extension     TEXT    NOT NULL,
      directory     TEXT    NOT NULL,
      size_bytes    INTEGER NOT NULL,
      modified_at   INTEGER NOT NULL,
      vertex_count  INTEGER DEFAULT 0,
      face_count    INTEGER DEFAULT 0,
      thumbnail     TEXT,
      indexed_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_ext  ON files(extension);
    CREATE INDEX IF NOT EXISTS idx_files_dir  ON files(directory);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  return db;
}

export function getDb() {
  if (!db)
    throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}
