import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncDirectoryAsync,
  syncDirectorySync,
  type AsyncDirectorySyncIo,
  type SyncDirectorySyncIo,
} from '../../../../src/main/directorySync';

function errorWithCode(code: string) {
  return Object.assign(new Error(code), { code });
}

test('Windows skips EPERM from directory fsync for async and sync writers', async () => {
  const calls: string[] = [];
  const asyncIo: AsyncDirectorySyncIo = {
    open: async () => ({ sync: async () => { calls.push('async-sync'); throw errorWithCode('EPERM'); }, close: async () => { calls.push('async-close'); } }),
  };
  const syncIo: SyncDirectorySyncIo = {
    openSync: () => 1,
    fsyncSync: () => { calls.push('sync-sync'); throw errorWithCode('EPERM'); },
    closeSync: () => { calls.push('sync-close'); },
  };
  await assert.doesNotReject(syncDirectoryAsync('C:\\restore', asyncIo, 'win32'));
  assert.doesNotThrow(() => syncDirectorySync('C:\\restore', syncIo, 'win32'));
  assert.deepEqual(calls, ['async-sync', 'async-close', 'sync-sync', 'sync-close']);
});

test('Windows skips an unsupported directory fsync but still closes the opened handle', async () => {
  const calls: string[] = [];
  const asyncIo: AsyncDirectorySyncIo = {
    open: async () => ({
      sync: async () => { calls.push('sync'); throw errorWithCode('ENOTSUP'); },
      close: async () => { calls.push('close'); },
    }),
  };
  await assert.doesNotReject(syncDirectoryAsync('C:\\restore', asyncIo, 'win32'));
  assert.deepEqual(calls, ['sync', 'close']);
});

test('POSIX always attempts and completes directory fsync after atomic rename', async () => {
  const calls: string[] = [];
  const io: AsyncDirectorySyncIo = {
    open: async (directory, flags) => {
      calls.push(`open:${directory}:${flags}`);
      return { sync: async () => { calls.push('sync'); }, close: async () => { calls.push('close'); } };
    },
  };
  await syncDirectoryAsync('/tmp/restore', io, 'darwin');
  assert.deepEqual(calls, ['open:/tmp/restore:r', 'sync', 'close']);
});

test('unsupported-looking directory errors are not swallowed on POSIX', async () => {
  const io: AsyncDirectorySyncIo = { open: async () => ({ sync: async () => { throw errorWithCode('EPERM'); }, close: async () => undefined }) };
  await assert.rejects(syncDirectoryAsync('/tmp/restore', io, 'linux'), /EPERM/);
});

test('Windows does not treat directory-open EPERM as unsupported fsync', async () => {
  const asyncIo: AsyncDirectorySyncIo = { open: async () => { throw errorWithCode('EPERM'); } };
  const syncIo: SyncDirectorySyncIo = { openSync: () => { throw errorWithCode('EPERM'); }, fsyncSync: () => undefined, closeSync: () => undefined };
  await assert.rejects(syncDirectoryAsync('C:\\restore', asyncIo, 'win32'), /EPERM/);
  assert.throws(() => syncDirectorySync('C:\\restore', syncIo, 'win32'), /EPERM/);
});

test('Windows propagates real directory sync and open errors from both writers', async () => {
  const asyncSyncError: AsyncDirectorySyncIo = { open: async () => ({ sync: async () => { throw errorWithCode('EIO'); }, close: async () => undefined }) };
  const syncSyncError: SyncDirectorySyncIo = { openSync: () => 1, fsyncSync: () => { throw errorWithCode('EIO'); }, closeSync: () => undefined };
  const asyncOpenError: AsyncDirectorySyncIo = { open: async () => { throw errorWithCode('EIO'); } };
  const syncOpenError: SyncDirectorySyncIo = { openSync: () => { throw errorWithCode('EIO'); }, fsyncSync: () => undefined, closeSync: () => undefined };
  await assert.rejects(syncDirectoryAsync('C:\\restore', asyncSyncError, 'win32'), /EIO/);
  assert.throws(() => syncDirectorySync('C:\\restore', syncSyncError, 'win32'), /EIO/);
  await assert.rejects(syncDirectoryAsync('C:\\restore', asyncOpenError, 'win32'), /EIO/);
  assert.throws(() => syncDirectorySync('C:\\restore', syncOpenError, 'win32'), /EIO/);
});
