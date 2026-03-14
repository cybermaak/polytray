import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import Database from 'better-sqlite3';

import { createDbAtVersion } from '../../../support/helpers/databaseFixtures';

import {
  LATEST_DB_VERSION,
  MIGRATIONS,
} from '../../../../src/main/database';

for (const version of [0, 1, 2, 3, 4]) {
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
        ]) {
          assert.equal(columnNames.includes(expected), true);
        }
      } finally {
        database.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
