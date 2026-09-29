import fs from 'node:fs';

export interface AsyncDirectorySyncHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface AsyncDirectorySyncIo {
  open(directory: string, flags: 'r'): Promise<AsyncDirectorySyncHandle>;
}
export interface SyncDirectorySyncIo {
  openSync(directory: string, flags: 'r'): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
}

// Node delegates fsync to platform APIs. Windows can reject flushing a directory
// handle even after the file itself was synced and the rename succeeded.
const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  'EPERM', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS',
]);

function isUnsupportedWindowsDirectorySync(error: unknown, platform: string) {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return platform === 'win32' && typeof code === 'string' && WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code);
}

const defaultAsyncIo: AsyncDirectorySyncIo = {
  open: (directory, flags) => fs.promises.open(directory, flags),
};
const defaultSyncIo: SyncDirectorySyncIo = {
  openSync: (directory, flags) => fs.openSync(directory, flags),
  fsyncSync: fd => fs.fsyncSync(fd),
  closeSync: fd => fs.closeSync(fd),
};

/**
 * Flushes directory rename metadata where supported. On Windows, only known
 * unsupported fsync errors are ignored; directory-open, close, and other I/O
 * errors remain fatal. The caller has already synced the temporary file.
 */
export async function syncDirectoryAsync(
  directory: string,
  io: AsyncDirectorySyncIo = defaultAsyncIo,
  platform = process.platform,
) {
  const handle = await io.open(directory, 'r');
  try {
    try { await handle.sync(); }
    catch (error) {
      if (isUnsupportedWindowsDirectorySync(error, platform)) return;
      throw error;
    }
  } finally {
    await handle.close();
  }
}

/** Synchronous equivalent for callers whose atomic write is synchronous. */
export function syncDirectorySync(
  directory: string,
  io: SyncDirectorySyncIo = defaultSyncIo,
  platform = process.platform,
) {
  const fd = io.openSync(directory, 'r');
  try {
    try { io.fsyncSync(fd); }
    catch (error) {
      if (isUnsupportedWindowsDirectorySync(error, platform)) return;
      throw error;
    }
  } finally {
    io.closeSync(fd);
  }
}
