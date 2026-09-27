import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { IpcMain } from 'electron';
import { registerMetadataBackupHandlers, METADATA_BACKUP_EXPORT_CHANNEL } from '../../../../src/main/ipc/metadataBackup';
import { createFilesTableForTests } from '../../../../src/main/fileIndexing';

test('export IPC validates renderer snapshot and registers no import stubs', async () => {
  const db = new Database(':memory:');
  createFilesTableForTests(db);
  db.exec('ALTER TABLE files ADD COLUMN tags TEXT; ALTER TABLE files ADD COLUMN notes TEXT; ALTER TABLE files ADD COLUMN print_status TEXT;');
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler),
  } as unknown as IpcMain;
  let dialogCalls = 0;
  registerMetadataBackupHandlers({
    ipcMain,
    db,
    dialog: { showSaveDialog: async () => { dialogCalls += 1; return { canceled: true }; } } as never,
    appVersion: '1.1.1',
    getCurrentRendererRevision: () => 1,
  });
  try {
    assert.deepEqual([...handlers.keys()], [METADATA_BACKUP_EXPORT_CHANNEL]);
    const invoke = handlers.get(METADATA_BACKUP_EXPORT_CHANNEL)!;
    const malformed = await invoke({}, { rendererRevision: -1, libraryRoots: [], collections: [], preferences: {} });
    assert.equal((malformed as { status: string; code: string }).status, 'failed');
    assert.equal((malformed as { code: string }).code, 'invalid-snapshot');
    assert.equal(dialogCalls, 0);

    const cancelled = await invoke({}, { rendererRevision: 1, libraryRoots: [], collections: [], preferences: {} });
    assert.deepEqual(cancelled, { status: 'cancelled' });
    assert.equal(dialogCalls, 1);
  } finally {
    db.close();
  }
});
