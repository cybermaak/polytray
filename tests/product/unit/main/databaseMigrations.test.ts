import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import Database from 'better-sqlite3';

import { createDbAtVersion } from '../../../support/helpers/databaseFixtures';

import {
  LATEST_DB_VERSION,
  MIGRATIONS,
} from '../../../../src/main/database';

for (const version of [0, 1, 2, 3, 4, 5]) {
  test(`migrations upgrade schema from version ${version} to latest`, () => {
    const { dbPath, dir } = createDbAtVersion(version);
    try {
      const database = new Database(dbPath);
      try {
        const pendingMigrations = MIGRATIONS.filter((migration) => migration.version > version);
        if (pendingMigrations.length > 0) {
          for (const migration of pendingMigrations) {
            database.exec(migration.sql);
          }
          database.pragma(`user_version = ${LATEST_DB_VERSION}`);
        }

        const currentVersion = database.pragma('user_version', { simple: true }) as number;
        assert.equal(currentVersion, LATEST_DB_VERSION);

        const columns = database.prepare('PRAGMA table_info(files);').all() as Array<{ name: string }>;
        const columnNames = columns.map((column) => column.name);

        for (const expected of [
          'thumbnail_failed',
          'tags',
          'notes',
          'print_status',
          'dimensions',
          'content_revision',
          'archive_path',
          'scan_generation',
        ]) {
          assert.equal(columnNames.includes(expected), true);
        }

        assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'file_scopes'").get() !== undefined, true);
        assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'library_revisions'").get() !== undefined, true);
        assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_annotations'").get() !== undefined, true);
        assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata_import_transactions'").get() !== undefined, true);
        assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata_restore_conflicts'").get() !== undefined, true);
      } finally {
        database.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('migration 5 retains file annotations and initializes revision identity', () => {
  const { dbPath, dir } = createDbAtVersion(4);
  try {
    const database = new Database(dbPath);
    try {
      database.prepare(`INSERT INTO files (
        path, name, extension, directory, size_bytes, modified_at, tags, notes,
        print_status, dimensions, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('/models/kept.stl', 'kept', 'stl', '/models', 12, 34, '["favorite"]', 'keep me', 'Testing', '{"x":1,"y":2,"z":3}', 56);
      const migration = MIGRATIONS.find((entry) => entry.version === 5);
      assert.ok(migration);
      database.exec(migration.sql);

      const row = database.prepare('SELECT tags, notes, print_status, dimensions, content_revision, archive_path FROM files WHERE path = ?')
        .get('/models/kept.stl') as Record<string, unknown>;
      assert.deepEqual(row, {
        tags: '["favorite"]',
        notes: 'keep me',
        print_status: 'Testing',
        dimensions: '{"x":1,"y":2,"z":3}',
        content_revision: 1,
        archive_path: null,
      });
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration 5 indexes case-insensitive name order with stable file id ties', () => {
  const { dbPath, dir } = createDbAtVersion(5);
  try {
    const database = new Database(dbPath);
    try {
      const insert = database.prepare(`INSERT INTO files (
        path, name, extension, directory, size_bytes, modified_at, indexed_at
      ) VALUES (?, ?, 'stl', '/models', 1, 1, 1)`);
      insert.run('/models/one.stl', 'part');
      insert.run('/models/two.stl', 'Part');
      insert.run('/models/three.stl', 'alpha');
      const names = database.prepare('SELECT name FROM files ORDER BY name COLLATE NOCASE ASC, id ASC').all() as Array<{ name: string }>;
      assert.deepEqual(names.map((row) => row.name), ['alpha', 'part', 'Part']);

      const index = database.prepare('PRAGMA index_xinfo(idx_files_name)').all() as Array<{ name: string | null; coll: string | null }>;
      assert.equal(index.some((column) => column.name === 'name' && column.coll === 'NOCASE'), true);
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
