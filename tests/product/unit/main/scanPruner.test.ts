import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { applyWatchedFileRecord, createFileIndexRepository, subscribeToFileIndexMutations } from '../../../../src/main/fileIndexing';
import { captureScanPruneSnapshot, pruneScanSnapshot } from '../../../../src/main/scanPruner';
import { discoverFolder } from '../../../../src/main/scanner';
import { MIGRATIONS } from '../../../../src/main/database';
import { matchesScanSnapshot } from '../../../../src/main/scanCoverage';

test('production SQLite prune preserves concurrent writes and prunes truly removed child and ZIP members', async () => {
  const db = new Database(':memory:');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-pruner-library-'));
  const root = path.resolve(temp);
  const removedChild = path.join(root, 'removed-child');
  const removedArchive = path.join(root, 'removed.zip');
  fs.mkdirSync(removedChild);
  fs.writeFileSync(path.join(removedChild, 'old.stl'), 'solid old');
  fs.writeFileSync(removedArchive, await new JSZip().file('old.obj', 'v 0 0 0').generateAsync({ type: 'nodebuffer' }));
  db.exec(MIGRATIONS.map((migration) => migration.sql).join('\n'));
  const repository = createFileIndexRepository(db);
  const add = (filePath: string, name: string) => repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: filePath, name, extension: 'stl', directory: root, sizeBytes: 10, modifiedAt: 1, scanGeneration: 1,
  }] }).committed[0].id;
  const untouched = add(path.join(root, 'removed.stl'), 'removed');
  const watcher = add(path.join(root, 'watcher.stl'), 'watcher');
  const annotated = add(path.join(root, 'annotated.stl'), 'annotated');
  const recreatedPath = path.join(root, 'recreated.stl');
  const oldIdentity = add(recreatedPath, 'old');
  const removedChildRow = add(path.join(removedChild, 'old.stl'), 'old');
  const removedArchiveRow = add(`${removedArchive}::entry::old.obj`, 'old');
  const snapshot = captureScanPruneSnapshot(db, root);
  const watcherSnapshot = snapshot.find((row) => row.id === watcher)!;

  applyWatchedFileRecord(db, {
    path: path.join(root, 'watcher.stl'), name: 'watcher', ext: 'stl', dir: root,
    size: 10, modifiedAt: 1, vertexCount: 1, faceCount: 1, dimensions: null,
    thumbnailPath: null, thumbnailFailed: 0, indexedAt: watcherSnapshot.indexed_at,
  });
  const watcherAfterEvent = db.prepare('SELECT * FROM files WHERE id = ?').get(watcher) as typeof watcherSnapshot;
  assert.equal(watcherAfterEvent.indexed_at, watcherSnapshot.indexed_at);
  assert.equal(watcherAfterEvent.modified_at, watcherSnapshot.modified_at);
  assert.equal(watcherAfterEvent.size_bytes, watcherSnapshot.size_bytes);
  assert.notEqual(watcherAfterEvent.scan_generation, watcherSnapshot.scan_generation);
  assert.equal(watcherAfterEvent.content_revision > watcherSnapshot.content_revision, true);
  assert.equal(matchesScanSnapshot(watcherSnapshot, watcherAfterEvent), false);
  db.prepare('UPDATE files SET tags = ?, notes = ?, print_status = ? WHERE id = ?').run('["during-scan"]', 'new note', 'printed', annotated);
  db.prepare('DELETE FROM files WHERE id = ?').run(oldIdentity);
  const newIdentity = add(recreatedPath, 'recreated');
  assert.notEqual(newIdentity, oldIdentity);
  fs.rmSync(removedChild, { recursive: true, force: true });
  fs.rmSync(removedArchive, { force: true });
  const discovery = await discoverFolder(root);
  assert.equal(discovery.state, 'completed');

  const mutations: Array<{ paths: string[]; browseRevision: number }> = [];
  const unsubscribe = subscribeToFileIndexMutations(db, (mutation) => mutations.push({ paths: mutation.affectedPaths, browseRevision: mutation.browseRevision }));
  const revisionsBeforePrune = db.prepare('SELECT browse_revision, stats_revision, topology_revision FROM library_revisions WHERE singleton = 1').get() as Record<string, number>;
  const result = pruneScanSnapshot(db, root, discovery, snapshot);
  unsubscribe();

  assert.equal(result.deletedCount, 3);
  assert.equal(result.retainedCount, 3);
  assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(untouched), undefined);
  assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(removedChildRow), undefined);
  assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(removedArchiveRow), undefined);
  assert.ok(db.prepare('SELECT id FROM files WHERE id = ?').get(watcher));
  assert.equal((db.prepare('SELECT tags FROM files WHERE id = ?').get(annotated) as { tags: string }).tags, '["during-scan"]');
  assert.ok(db.prepare('SELECT id FROM files WHERE id = ? AND path = ?').get(newIdentity, recreatedPath));
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM file_scopes WHERE file_id IN (?, ?, ?)').get(untouched, removedChildRow, removedArchiveRow) as { count: number }).count, 0);
  const revisionsAfterPrune = db.prepare('SELECT browse_revision, stats_revision, topology_revision FROM library_revisions WHERE singleton = 1').get() as Record<string, number>;
  assert.equal(revisionsAfterPrune.browse_revision, revisionsBeforePrune.browse_revision + 1);
  assert.equal(revisionsAfterPrune.stats_revision, revisionsBeforePrune.stats_revision + 1);
  assert.equal(revisionsAfterPrune.topology_revision, revisionsBeforePrune.topology_revision + 1);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].paths.length, 3);
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});
