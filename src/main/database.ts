import Database from "better-sqlite3";
import { app } from "electron";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

export function initDatabase() {
  const userDataPath =
    process.env.ELECTRON_USER_DATA || app.getPath("userData");
  const dbDir = path.join(userDataPath, "data");
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, "polytray.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent reads
  db.pragma("journal_mode = WAL");

  // Implement lightweight sequential schema migrations
  let currentVersion =
    (db.pragma("user_version", { simple: true }) as number) || 0;

  if (currentVersion === 0) {
    // Initial Schema (v1)
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
    db.pragma("user_version = 1");
    currentVersion = 1;
  }

  if (currentVersion === 1) {
    // Migration v1 -> v2: Add thumbnail_failed column
    try {
      db.prepare(
        "ALTER TABLE files ADD COLUMN thumbnail_failed INTEGER DEFAULT 0",
      ).run();
    } catch (e: any) {
      if (!e.message.includes("duplicate column name")) {
        console.warn("Schema migration v2 warning:", e.message);
      }
    }
    db.pragma("user_version = 2");
    currentVersion = 2;
  }

  return db;
}

export function getDb() {
  if (!db)
    throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}
