import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { applyWatchedFileRecord, createFilesTableForTests } from '../../../../src/main/fileIndexing';
import { captureScanPruneSnapshot, pruneScanSnapshot } from '../../../../src/main/scanPruner';
import { discoverFolder } from '../../../../src/main/scanner';

test('production SQLite prune preserves concurrent writes and prunes truly removed child and ZIP members', async () => {
  const db = new Database(':memory:');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-pruner-library-'));
  const root = path.resolve(temp);
  const removedChild = path.join(root, 'removed-child');
  const removedArchive = path.join(root, 'removed.zip');
  fs.mkdirSync(removedChild);
  fs.writeFileSync(path.join(removedChild, 'old.stl'), 'solid old');
  fs.writeFileSync(removedArchive, await new JSZip().file('old.obj', 'v 0 0 0').generateAsync({ type: 'nodebuffer' }));
  createFilesTableForTests(db);
  db.exec('ALTER TABLE files ADD COLUMN tags TEXT; ALTER TABLE files ADD COLUMN notes TEXT; ALTER TABLE files ADD COLUMN print_status TEXT;');
  const insert = db.prepare(`INSERT INTO files(path,name,extension,directory,size_bytes,modified_at,indexed_at,tags,notes,print_status)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const add = (filePath: string, name: string) => Number(insert.run(filePath, name, 'stl', root, 10, 1, 1, null, null, null).lastInsertRowid);
  const untouched = add(path.join(root, 'removed.stl'), 'removed');
  const watcher = add(path.join(root, 'watcher.stl'), 'watcher');
  const annotated = add(path.join(root, 'annotated.stl'), 'annotated');
  const recreatedPath = path.join(root, 'recreated.stl');
  const oldIdentity = add(recreatedPath, 'old');
  const removedChildRow = add(path.join(removedChild, 'old.stl'), 'old');
  const removedArchiveRow = add(`${removedArchive}::entry::old.obj`, 'old');
  const snapshot = captureScanPruneSnapshot(db, root);

  applyWatchedFileRecord(db, {
    path: path.join(root, 'watcher.stl'), name: 'watcher', ext: 'stl', dir: root,
    size: 11, modifiedAt: 9, vertexCount: 1, faceCount: 1, dimensions: null,
    thumbnailPath: null, thumbnailFailed: 0, indexedAt: 9,
  });
  db.prepare('UPDATE files SET tags = ?, notes = ?, print_status = ? WHERE id = ?').run('["during-scan"]', 'new note', 'printed', annotated);
  db.prepare('DELETE FROM files WHERE id = ?').run(oldIdentity);
  const newIdentity = add(recreatedPath, 'recreated');
  assert.notEqual(newIdentity, oldIdentity);
  fs.rmSync(removedChild, { recursive: true, force: true });
  fs.rmSync(removedArchive, { force: true });
  const discovery = await discoverFolder(root);
  assert.equal(discovery.state, 'completed');

  const result = pruneScanSnapshot(db, root, discovery, snapshot);

  assert.equal(result.deletedCount, 3);
  assert.equal(result.retainedCount, 3);
  assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(untouched), undefined);
  assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(removedChildRow), undefined);
  assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(removedArchiveRow), undefined);
  assert.ok(db.prepare('SELECT id FROM files WHERE id = ?').get(watcher));
  assert.equal((db.prepare('SELECT tags FROM files WHERE id = ?').get(annotated) as { tags: string }).tags, '["during-scan"]');
  assert.ok(db.prepare('SELECT id FROM files WHERE id = ? AND path = ?').get(newIdentity, recreatedPath));
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});
