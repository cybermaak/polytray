import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import Database from 'better-sqlite3';

import { createDbAtVersion } from '../../../support/helpers/databaseFixtures';

import {
  LATEST_DB_VERSION,
  runMigrationsOnDatabase,
} from '../../../../src/main/database';

test('createDbAtVersion creates a reusable database fixture without sqlite3 cli', () => {
  const { dbPath, dir } = createDbAtVersion(2);

  try {
    assert.equal(fs.existsSync(dbPath), true);

    const database = new Database(dbPath);
    try {
      const currentVersion = database.pragma('user_version', { simple: true }) as number;
      assert.equal(currentVersion, 2);

      runMigrationsOnDatabase(database);

      const migratedVersion = database.pragma('user_version', { simple: true }) as number;
      assert.equal(migratedVersion, LATEST_DB_VERSION);
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
