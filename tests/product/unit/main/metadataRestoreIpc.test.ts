import test from 'node:test';
import assert from 'node:assert/strict';
import type { IpcMain } from 'electron';
import { registerMetadataRestoreHandlers, METADATA_RESTORE_CHANNELS } from '../../../../src/main/ipc/metadataBackup';
import type { MetadataRestoreService } from '../../../../src/shared/backupContracts';

test('restore IPC exposes preview, staged commit, acknowledgment, status, retry, and cancel handlers', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const calls: string[] = [];
  const service = {
    getCurrentSnapshot: () => ({ rendererRevision: 3, libraryRoots: [], collections: [], preferences: {} }),
    previewImport: () => { calls.push('preview'); return { transactionId: 'restore-1' }; },
    commitImport: async () => { calls.push('commit'); return { status: 'staged' }; },
    acknowledgeImport: async () => { calls.push('ack'); },
    cancelImport: async () => { calls.push('cancel'); },
    getStatus: async () => ({ unresolved: false }),
    retryPendingAnnotations: () => ({ appliedCount: 0, conflictCount: 0 }),
    reconcileImport: async () => ({ status: 'none' }),
    dispose: () => undefined,
  } as unknown as MetadataRestoreService;
  registerMetadataRestoreHandlers({ ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as unknown as IpcMain, service });
  try {
    assert.equal(handlers.size, 7);
    assert.deepEqual(Object.values(METADATA_RESTORE_CHANNELS).map(channel => handlers.has(channel)), [true, true, true, true, true, true, true]);
    await handlers.get(METADATA_RESTORE_CHANNELS.preview)!({}, { backup: {}, currentSnapshot: {} });
    await handlers.get(METADATA_RESTORE_CHANNELS.commit)!({}, { transactionId: 'restore-1' });
    await handlers.get(METADATA_RESTORE_CHANNELS.acknowledge)!({}, { transactionId: 'restore-1', rendererRevision: 3 });
    assert.deepEqual(calls, ['preview', 'commit', 'ack']);
  } finally { /* IpcMain listeners belong to app lifetime in this isolated fixture. */ }
});
