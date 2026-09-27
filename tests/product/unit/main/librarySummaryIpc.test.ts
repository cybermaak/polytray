import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { IpcMain } from 'electron';
import { MIGRATIONS } from '../../../../src/main/database';
import { createFileIndexRepository, type CommittedFileMutation } from '../../../../src/main/fileIndexing';
import { IPC } from '../../../../src/shared/types';
import { registerLibrarySummaryHandlers } from '../../../../src/main/ipc/files';

test('summary IPC returns cached values and follows committed insert/annotation mutation flags', () => {
  const db = new Database(':memory:');
  db.exec(MIGRATIONS.map((migration) => migration.sql).join('\n'));
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle(channel: string, handler: (...args: unknown[]) => unknown) { handlers.set(channel, handler); },
  } as unknown as IpcMain;
  registerLibrarySummaryHandlers(ipcMain, () => db);

  try {
    const getStats = handlers.get(IPC.GET_STATS)!;
    const getDirectories = handlers.get(IPC.GET_DIRECTORIES)!;
    const mutations: CommittedFileMutation[] = [];
    const repository = createFileIndexRepository(db, (mutation) => mutations.push(mutation));
    assert.deepEqual(getStats({}), { total: 0, stl: 0, obj: 0, threemf: 0, totalSize: 0 });
    assert.deepEqual(getDirectories({}), []);

    const filePath = path.resolve('/library/sub/model.stl');
    const inserted = repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: filePath, name: 'model', extension: 'stl', directory: path.dirname(filePath),
      sizeBytes: 1234, modifiedAt: 100, scanGeneration: 1,
    }] });
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].statsChanged, true);
    assert.equal(mutations[0].topologyChanged, true);
    const afterInsertStats = getStats({});
    const afterInsertDirectories = getDirectories({});
    assert.deepEqual(afterInsertStats, { total: 1, stl: 1, obj: 0, threemf: 0, totalSize: 1234 });
    assert.deepEqual(afterInsertDirectories, [path.dirname(filePath)]);
    assert.strictEqual(getStats({}), afterInsertStats);
    assert.strictEqual(getDirectories({}), afterInsertDirectories);

    const identity = inserted.committed[0];
    const annotation = repository.updateFileMetadata({
      fileId: identity.id, expectedContentRevision: identity.contentRevision,
      tags: ['favorite'], notes: 'Saved note',
    });
    assert.equal(annotation.status, 'updated');
    assert.equal(mutations.length, 2);
    assert.equal(mutations[1].annotationsChanged, true);
    assert.equal(mutations[1].statsChanged, false);
    assert.equal(mutations[1].topologyChanged, false);
    assert.strictEqual(getStats({}), afterInsertStats);
    assert.strictEqual(getDirectories({}), afterInsertDirectories);
  } finally {
    db.close();
  }
});
