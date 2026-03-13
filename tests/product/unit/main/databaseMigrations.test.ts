import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  LATEST_DB_VERSION,
  MIGRATIONS,
} from '../../../../src/main/database';

function createDbAtVersion(version: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-migration-'));
  const dbPath = path.join(dir, 'polytray.db');

  const statements: string[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) {
      statements.push(migration.sql);
    }
  }
  statements.push(`PRAGMA user_version = ${version};`);
  execFileSync('sqlite3', [dbPath, statements.join('\n')]);

  return { dbPath, dir };
}

for (const version of [0, 1, 2, 3, 4]) {
  test(`migrations upgrade schema from version ${version} to latest`, () => {
    const { dbPath, dir } = createDbAtVersion(version);
    try {
      const pendingMigrations = MIGRATIONS.filter((migration) => migration.version > version);
      if (pendingMigrations.length > 0) {
        execFileSync('sqlite3', [
          dbPath,
          [
            ...pendingMigrations.map((migration) => migration.sql),
            `PRAGMA user_version = ${LATEST_DB_VERSION};`,
          ].join('\n'),
        ]);
      }

      const currentVersion = execFileSync('sqlite3', [dbPath, 'PRAGMA user_version;'], {
        encoding: 'utf8',
      }).trim();
      assert.equal(Number(currentVersion), LATEST_DB_VERSION);

      const columnsRaw = execFileSync('sqlite3', [dbPath, 'PRAGMA table_info(files);'], {
        encoding: 'utf8',
      });
      const columnNames = columnsRaw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('|')[1]);

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
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
