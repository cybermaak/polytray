import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { backfillFileScopes, canonicalizeScopePath, enumerateFileScopes, enumerateFileScopesForPlatform, isScopeBackfillComplete } from '../../../../src/main/fileScopes';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../../../src/main/database';
import { isPathContained } from '../../../../src/main/pathContainment';

test('native scopes contain canonical ancestors without sibling-prefix matches', () => {
  const scopes = enumerateFileScopesForPlatform('/models/library-2/part/model.stl', 'posix');

  assert.deepEqual(scopes, [
    '/',
    '/models',
    '/models/library-2',
    '/models/library-2/part',
  ]);
  assert.equal(scopes.includes('/models/library'), false);
});

test('archive entry scopes include its physical archive ancestry and virtual ancestors', () => {
  const scopes = enumerateFileScopesForPlatform('/models/kits.zip::entry::set\\large\\part.3mf', 'posix');

  assert.deepEqual(scopes, [
    path.posix.resolve('/'),
    path.posix.resolve('/models'),
    path.posix.resolve('/models/kits.zip'),
    '/models/kits.zip::entry::',
    '/models/kits.zip::entry::set',
    '/models/kits.zip::entry::set/large',
  ]);
});

test('archive subfolder scopes do not include sibling virtual folders', () => {
  const scopes = enumerateFileScopesForPlatform('/models/kits.zip::entry::catalogue-v2/a.stl', 'posix');

  assert.equal(scopes.includes('/models/kits.zip::entry::catalogue'), false);
  assert.equal(scopes.includes('/models/kits.zip::entry::catalogue-v2'), true);
});

test('archive scope aliases normalize dot segments exactly like virtual containment', () => {
  const scope = canonicalizeScopePath('/tmp/kits.zip::entry::a/../parts', 'posix');
  const memberScopes = enumerateFileScopesForPlatform('/tmp/kits.zip::entry::parts/model.stl', 'posix');
  const aliasMemberScopes = enumerateFileScopesForPlatform('/tmp/kits.zip::entry::parts/unused/../model.stl', 'posix');

  assert.equal(isPathContained('/tmp/kits.zip::entry::a/../parts', '/tmp/kits.zip::entry::parts/model.stl'), true);
  assert.equal(scope, '/tmp/kits.zip::entry::parts');
  assert.equal(memberScopes.includes(scope), true);
  assert.equal(aliasMemberScopes.includes(scope), true);
});

test('Windows native scope keys ignore case while archive headers and members retain their comparison semantics', () => {
  const upperScopes = enumerateFileScopesForPlatform('C:\\Models\\kits.zip::entry::Parts/model.stl', 'win32');
  const lowerScopes = enumerateFileScopesForPlatform('c:\\models\\kits.zip::entry::Parts/model.stl', 'win32');

  assert.deepEqual(upperScopes.slice(0, 2), lowerScopes.slice(0, 2));
  assert.notEqual(
    canonicalizeScopePath('C:\\Models\\kits.zip::entry::Parts', 'win32'),
    canonicalizeScopePath('c:\\models\\kits.zip::entry::Parts', 'win32'),
  );
  assert.notEqual(
    canonicalizeScopePath('C:\\Models\\kits.zip::entry::Parts', 'win32'),
    canonicalizeScopePath('C:\\Models\\kits.zip::entry::parts', 'win32'),
  );
});

test('Windows drive and UNC scopes are canonicalized on every host', () => {
  const drive = enumerateFileScopesForPlatform('C:\\Models\\Kit\\part.stl', 'win32');
  assert.deepEqual(drive, ['c:\\', 'c:\\models', 'c:\\models\\kit']);

  const unc = enumerateFileScopesForPlatform('\\\\SERVER\\Share\\Models\\part.stl', 'win32');
  assert.deepEqual(unc, [
    path.win32.resolve('\\\\server\\share\\').toLowerCase(),
    path.win32.resolve('\\\\server\\share\\models').toLowerCase(),
  ]);
});

test('native Windows scope enumeration stores lowercase native ancestor keys', { skip: process.platform !== 'win32' }, () => {
  const scopes = enumerateFileScopes('C:\\Models\\Kit\\part.stl');
  assert.deepEqual(scopes, ['c:\\', 'c:\\models', 'c:\\models\\kit']);
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
