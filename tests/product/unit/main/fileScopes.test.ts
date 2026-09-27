import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { backfillFileScopes, enumerateFileScopes, isScopeBackfillComplete } from '../../../../src/main/fileScopes';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../../../src/main/database';

test('native scopes contain canonical ancestors without sibling-prefix matches', () => {
  const scopes = enumerateFileScopes('/models/library-2/part/model.stl');

  assert.deepEqual(scopes, [
    path.resolve('/'),
    path.resolve('/models'),
    path.resolve('/models/library-2'),
    path.resolve('/models/library-2/part'),
  ]);
  assert.equal(scopes.includes(path.resolve('/models/library')), false);
});

test('archive entry scopes include its physical archive ancestry and virtual ancestors', () => {
  const scopes = enumerateFileScopes('/models/kits.zip::entry::set\\large\\part.3mf');

  assert.deepEqual(scopes, [
    path.resolve('/'),
    path.resolve('/models'),
    path.resolve('/models/kits.zip'),
    '/models/kits.zip::entry::',
    '/models/kits.zip::entry::set',
    '/models/kits.zip::entry::set/large',
  ]);
});

test('archive subfolder scopes do not include sibling virtual folders', () => {
  const scopes = enumerateFileScopes('/models/kits.zip::entry::catalogue-v2/a.stl');

  assert.equal(scopes.includes('/models/kits.zip::entry::catalogue'), false);
  assert.equal(scopes.includes('/models/kits.zip::entry::catalogue-v2'), true);
});

test('Windows scope enumeration follows native path roots on Windows', { skip: process.platform !== 'win32' }, () => {
  const scopes = enumerateFileScopes('C:\\Models\\Kit\\part.stl');
  assert.deepEqual(scopes, ['C:\\', 'C:\\Models', 'C:\\Models\\Kit']);
});

test('scope backfill resumes in bounded batches and ignores rows deleted before their batch', () => {
  const database = new Database(':memory:');
  try {
    database.exec(MIGRATIONS.map((migration) => migration.sql).join('\n'));
    const insert = database.prepare(`INSERT INTO files (
      path, name, extension, directory, size_bytes, modified_at, indexed_at
    ) VALUES (?, ?, 'stl', '/models', 1, 1, 1)`);
    insert.run('/models/a.stl', 'a');
    insert.run('/models/b.stl', 'b');
    insert.run('/models/c.stl', 'c');

    const first = backfillFileScopes(database, 2);
    assert.equal(first.processed, 2);
    assert.equal(first.complete, false);
    database.prepare('DELETE FROM files WHERE path = ?').run('/models/c.stl');

    const second = backfillFileScopes(database, 2);
    assert.equal(second.processed, 0);
    assert.equal(second.complete, true);
    assert.equal(isScopeBackfillComplete(database), true);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM file_scopes').get() as { count: number }).count, 4);
  } finally {
    database.close();
  }
});
