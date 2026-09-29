import test from 'node:test';
import assert from 'node:assert/strict';
import type { IpcMain } from 'electron';
import { registerMetadataRestoreHandlers, METADATA_RESTORE_CHANNELS } from '../../../../src/main/ipc/metadataBackup';
import type { MetadataRestoreService } from '../../../../src/shared/backupContracts';
import { createMetadataRestoreMutationGate } from '../../../../src/main/metadataRestoreMutationGate';

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
    assert.equal(handlers.size, 10);
    assert.equal(Object.values(METADATA_RESTORE_CHANNELS).every(channel => handlers.has(channel)), true);
    await handlers.get(METADATA_RESTORE_CHANNELS.bootstrap)!({}, {
      rendererRevision: 3, libraryRoots: [], collections: [], preferences: {},
    });
    await handlers.get(METADATA_RESTORE_CHANNELS.preview)!({}, { backup: {}, currentSnapshot: {} });
    await handlers.get(METADATA_RESTORE_CHANNELS.commit)!({}, { transactionId: 'restore-1' });
    await handlers.get(METADATA_RESTORE_CHANNELS.acknowledge)!({}, { transactionId: 'restore-1', rendererRevision: 3 });
    assert.deepEqual(calls, ['preview', 'commit', 'ack']);
  } finally { /* IpcMain listeners belong to app lifetime in this isolated fixture. */ }
});

test('restore bootstrap publishes the real renderer snapshot and waits for recovery before startup backfill', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const order: string[] = [];
  const snapshot = { rendererRevision: 12, libraryRoots: ['/models'], collections: [], preferences: { watch: false } };
  const service = {
    getCurrentSnapshot: () => snapshot,
    reconcileImport: async () => { order.push('reconcile'); return { status: 'none' }; },
    previewImport: () => ({}), commitImport: async () => ({}), acknowledgeImport: async () => undefined,
    cancelImport: async () => undefined, getStatus: async () => ({}), retryPendingAnnotations: () => ({}), dispose: () => undefined,
  } as unknown as MetadataRestoreService;
  registerMetadataRestoreHandlers({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as unknown as IpcMain,
    service,
    updateRendererSnapshot: received => { order.push(`snapshot:${received.rendererRevision}`); },
    startAfterRecovery: async () => { order.push('backfill'); },
  });

  const current = await handlers.get(METADATA_RESTORE_CHANNELS.snapshot)!({}, snapshot);
  assert.deepEqual(current, snapshot);
  const recovered = await handlers.get(METADATA_RESTORE_CHANNELS.bootstrap)!({}, snapshot);
  assert.deepEqual(recovered, { status: 'none' });
  assert.deepEqual(order, ['snapshot:12', 'snapshot:12', 'reconcile', 'backfill']);
});

test('restore handlers reject a renderer that is not the registered main window', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const service = {
    getCurrentSnapshot: () => ({ rendererRevision: 0, libraryRoots: [], collections: [], preferences: {} }),
    previewImport: () => ({}), commitImport: async () => ({}), acknowledgeImport: async () => undefined,
    cancelImport: async () => undefined, reconcileImport: async () => ({ status: 'none' }),
    getStatus: async () => ({}), retryPendingAnnotations: () => ({}), dispose: () => undefined,
  } as unknown as MetadataRestoreService;
  registerMetadataRestoreHandlers({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as unknown as IpcMain,
    service,
    authorizeRenderer: () => { throw new Error('untrusted restore renderer'); },
  });
  await assert.rejects(handlers.get(METADATA_RESTORE_CHANNELS.snapshot)!({}, undefined), /untrusted restore renderer/);
});

test('blocked startup recovery locks renderer state and never starts backfill', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const order: string[] = [];
  const mutationGate = createMetadataRestoreMutationGate();
  let releaseBlockedGate: (() => Promise<void>) | null = null;
  let commitCalls = 0;
  const service = {
    getCurrentSnapshot: () => ({ rendererRevision: 4, libraryRoots: [], collections: [], preferences: {} }),
    previewImport: () => ({}), commitImport: async () => { commitCalls++; return { status: 'staged' }; }, acknowledgeImport: async () => undefined,
    cancelImport: async () => undefined, reconcileImport: async () => { order.push('reconcile'); return { status: 'blocked', message: 'journal corrupt' }; },
    getStatus: async () => ({}), retryPendingAnnotations: () => ({}), dispose: () => undefined,
  } as unknown as MetadataRestoreService;
  registerMetadataRestoreHandlers({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as unknown as IpcMain,
    service,
    holdRendererStateOnBlocked: async () => {
      releaseBlockedGate = await mutationGate.acquire();
      order.push('lock-renderer');
    },
    startAfterRecovery: async () => { order.push('backfill'); },
  });
  const result = await handlers.get(METADATA_RESTORE_CHANNELS.bootstrap)!({}, {
    rendererRevision: 4, libraryRoots: [], collections: [], preferences: {},
  });
  assert.deepEqual(result, { status: 'blocked', message: 'journal corrupt' });
  assert.deepEqual(order, ['reconcile', 'lock-renderer']);
  let mainMutationStarted = false;
  const queuedMutation = mutationGate.run(() => { mainMutationStarted = true; });
  await Promise.resolve();
  assert.equal(mutationGate.isLocked(), true);
  assert.equal(mainMutationStarted, false);
  const commit = await handlers.get(METADATA_RESTORE_CHANNELS.commit)!({}, { transactionId: 'blocked-restore' });
  assert.deepEqual(commit, { status: 'failed', message: 'Startup metadata recovery must finish before restore writes can run' });
  assert.equal(commitCalls, 0);
  await releaseBlockedGate!();
  await queuedMutation;
  assert.equal(mainMutationStarted, true);
});
