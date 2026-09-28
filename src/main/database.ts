import Database from "better-sqlite3";
import { app } from "electron";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

// ── Schema Migration Definitions ──────────────────────────────────
// Each migration runs exactly once, guarded by the SQLite user_version pragma.
// Add new migrations to the END of this array. Never remove or reorder entries.

export interface Migration {
  version: number; // Target version AFTER this migration runs
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema: files + settings tables with base indexes",
    sql: `
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
    `,
  },
  {
    version: 2,
    description: "Add thumbnail_failed column for retry tracking",
    sql: `ALTER TABLE files ADD COLUMN thumbnail_failed INTEGER DEFAULT 0;`,
  },
  {
    version: 3,
    description: "Add indexes on sort columns for performance",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_files_size     ON files(size_bytes);
      CREATE INDEX IF NOT EXISTS idx_files_modified  ON files(modified_at);
      CREATE INDEX IF NOT EXISTS idx_files_vertices  ON files(vertex_count);
      CREATE INDEX IF NOT EXISTS idx_files_faces     ON files(face_count);
    `,
  },
  {
    version: 4,
    description: "Add columns for tags, notes, print_status, and dimensions",
    sql: `
      ALTER TABLE files ADD COLUMN tags TEXT;
      ALTER TABLE files ADD COLUMN notes TEXT;
      ALTER TABLE files ADD COLUMN print_status TEXT DEFAULT 'Not Printed';
      ALTER TABLE files ADD COLUMN dimensions TEXT;
    `,
  },
  {
    version: 5,
    description: "Add revisioned file identity, indexed scopes, and library revisions",
    sql: `
      ALTER TABLE files ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE files ADD COLUMN archive_path TEXT;
      ALTER TABLE files ADD COLUMN scan_generation INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE file_scopes (
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        scope_path TEXT NOT NULL,
        UNIQUE (scope_path, file_id)
      );
      CREATE INDEX idx_file_scopes_file ON file_scopes(file_id, scope_path);

      CREATE TABLE library_revisions (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        content_sequence INTEGER NOT NULL,
        browse_revision INTEGER NOT NULL,
        stats_revision INTEGER NOT NULL,
        topology_revision INTEGER NOT NULL
      );
      INSERT INTO library_revisions VALUES (1, 1, 0, 0, 0);

      CREATE TABLE scope_backfill (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        cursor_file_id INTEGER NOT NULL,
        complete INTEGER NOT NULL
      );
      INSERT INTO scope_backfill VALUES (1, 0, 0);

      DROP INDEX IF EXISTS idx_files_name;
      DROP INDEX IF EXISTS idx_files_size;
      DROP INDEX IF EXISTS idx_files_modified;
      DROP INDEX IF EXISTS idx_files_vertices;
      DROP INDEX IF EXISTS idx_files_faces;
      CREATE INDEX idx_files_name ON files(name COLLATE NOCASE, id);
      CREATE INDEX idx_files_size ON files(size_bytes, id);
      CREATE INDEX idx_files_modified ON files(modified_at, id);
      CREATE INDEX idx_files_vertices ON files(vertex_count, id);
      CREATE INDEX idx_files_faces ON files(face_count, id);

      UPDATE library_revisions
      SET content_sequence = MAX(1, COALESCE((SELECT MAX(content_revision) FROM files), 0));
    `,
  },
  {
    version: 6,
    description: "Add durable pending annotations and metadata restore transactions",
    sql: `
      CREATE TABLE pending_annotations (
        canonical_path TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        tags TEXT NOT NULL,
        notes TEXT,
        print_status TEXT,
        provenance TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE metadata_import_transactions (
        transaction_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('database-applied', 'renderer-applied', 'complete')),
        renderer_revision INTEGER NOT NULL,
        browse_revision INTEGER NOT NULL,
        renderer_state TEXT NOT NULL,
        conflicts TEXT NOT NULL,
        recovery_backup_path TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE metadata_restore_conflicts (
        canonical_path TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        conflicts TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export const LATEST_DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// ── Database Initialization ───────────────────────────────────────

export function initDatabase() {
  const userDataPath =
    process.env.ELECTRON_USER_DATA || app.getPath("userData");
  const dbDir = path.join(userDataPath, "data");
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, "polytray.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent reads
  db.pragma("journal_mode = WAL");

  // Run pending migrations
  runMigrationsOnDatabase(db);

  return db;
}

export function runMigrationsOnDatabase(database: Database.Database) {
  let currentVersion =
    (database.pragma("user_version", { simple: true }) as number) || 0;

  for (const migration of MIGRATIONS) {
    if (currentVersion < migration.version) {
      console.log(
        `[DB] Running migration v${currentVersion} → v${migration.version}: ${migration.description}`,
      );

      // Run each migration inside a transaction for atomicity
      const transaction = database.transaction(() => {
        database.exec(migration.sql);
        database.pragma(`user_version = ${migration.version}`);
      });

      try {
        transaction();
        currentVersion = migration.version;
      } catch (e: unknown) {
        // Handle "duplicate column name" from ALTER TABLE re-runs gracefully
        const msg = (e as Error).message || "";
        if (msg.includes("duplicate column name")) {
          console.log(
            `[DB] Migration v${migration.version} column already exists, marking as applied`,
          );
          database.pragma(`user_version = ${migration.version}`);
          currentVersion = migration.version;
        } else {
          console.error(
            `[DB] Migration v${migration.version} FAILED:`,
            msg,
          );
          throw e; // Re-throw non-recoverable errors
        }
      }
    }
  }

  console.log(`[DB] Schema at version ${currentVersion}`);
}

// ── Database Accessors ────────────────────────────────────────────

export function getDb() {
  if (!db)
    throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

export function getSetting<T>(key: string, defaultValue: T): T {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { key: string; value: string } | undefined;
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export function setSetting<T>(key: string, value: T): void {
  const db = getDb();
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    serialized,
  );
}
