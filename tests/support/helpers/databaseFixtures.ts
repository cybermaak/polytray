import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { MIGRATIONS } from '../../../src/main/database';

export function createDbAtVersion(version: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-migration-'));
  const dbPath = path.join(dir, 'polytray.db');
  const database = new Database(dbPath);

  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) {
        database.exec(migration.sql);
      }
    }
    database.pragma(`user_version = ${version}`);
  } finally {
    database.close();
  }

  return { dbPath, dir };
}
