import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPerformanceDatabase } from '../fixtures/performanceFixtures';

test('performance database creates deterministic rows, folders, sort ties, and collection seed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-performance-fixture-test-'));
  try {
    const fixture = createPerformanceDatabase({ root, count: 600, archiveMemberShare: 0.2, archiveGroupCount: 12 });
    const db = fixture.openDatabase();
    try {
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 600);
      assert.equal(db.prepare('SELECT * FROM files ORDER BY name COLLATE NOCASE ASC LIMIT 500').all().length, 500);
      assert.equal((db.prepare('SELECT COUNT(DISTINCT directory) AS count FROM files').get() as { count: number }).count, 40);
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files WHERE archive_path IS NOT NULL').get() as { count: number }).count, 120);
      assert.equal((db.prepare('SELECT COUNT(DISTINCT archive_path) AS count FROM files WHERE archive_path IS NOT NULL').get() as { count: number }).count, 12);
      assert.ok((db.prepare('SELECT COUNT(*) AS count FROM files GROUP BY size_bytes ORDER BY count DESC LIMIT 1').get() as { count: number }).count > 1);
      assert.equal(fixture.collections.collections[0].filePaths.length, 600);
      assert.equal(fixture.lastOnlyCollection.collections[0].filePaths.length, 1);
      assert.equal(fixture.lastOnlyCollection.collections[0].filePaths[0], fixture.collections.collections[0].filePaths[599]);
      const flat = createPerformanceDatabase({ root: path.join(root, 'flat'), count: 600, archiveMemberShare: 0 });
      const flatDb = flat.openDatabase();
      try { assert.equal((flatDb.prepare('SELECT COUNT(*) AS count FROM files WHERE archive_path IS NOT NULL').get() as { count: number }).count, 0); }
      finally { flatDb.close(); }
    } finally { db.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fixture cleanup removes only a temporary root created by the fixture', () => {
  const fixture = createPerformanceDatabase({ count: 1 });
  const root = fixture.root;
  assert.equal(fs.existsSync(root), true);
  fixture.cleanup();
  assert.equal(fs.existsSync(root), false);
  const callerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-caller-owned-'));
  try {
    const callerOwned = createPerformanceDatabase({ root: callerRoot, count: 1 });
    callerOwned.cleanup();
    assert.equal(fs.existsSync(callerRoot), true);
  } finally { fs.rmSync(callerRoot, { recursive: true, force: true }); }
});

test('performance fixture can seed a complete scope index for cold-query comparison', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-ready-index-fixture-test-'));
  try {
    const fixture = createPerformanceDatabase({ root, count: 600, scopeIndex: 'ready' });
    const db = fixture.openDatabase();
    try {
      assert.equal((db.prepare('SELECT complete FROM scope_backfill WHERE singleton = 1').get() as { complete: number }).complete, 1);
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM file_scopes').get() as { count: number }).count > 600, true);
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM file_scopes AS s LEFT JOIN files AS f ON f.id = s.file_id WHERE f.id IS NULL').get() as { count: number }).count, 0);
    } finally { db.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
