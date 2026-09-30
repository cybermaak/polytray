import fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import { isPathContained } from './pathContainment';

const LOCAL_PROTOCOL_PREFIX = 'polytray://local/';

interface LocalFilePolicy {
  thumbnailDir: string;
  isIndexedFilePath: (filePath: string) => boolean;
}

export function decodePolytrayLocalFilePath(requestUrl: string): string | null {
  if (!requestUrl.startsWith(LOCAL_PROTOCOL_PREFIX)) {
    return null;
  }

  try {
    const urlPath = requestUrl.slice(LOCAL_PROTOCOL_PREFIX.length);
    return decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
}

export function isAllowedLocalFilePath(
  filePath: string,
  policy: LocalFilePolicy,
): boolean {
  if (isPathContained(policy.thumbnailDir, filePath)) {
    return isSafeThumbnailCacheFilePath(filePath, policy.thumbnailDir);
  }

  return policy.isIndexedFilePath(filePath) && isRegularNonSymlinkFilePath(filePath);
}

export function isRegularNonSymlinkFilePath(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Open the checked file itself so a final symlink swap cannot redirect the read. */
export async function openRegularFileNoFollow(
  filePath: string,
  openFile: (filePath: string, flags: number) => Promise<FileHandle> = fs.promises.open,
): Promise<FileHandle> {
  const before = await fs.promises.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('File is not a regular file');
  const handle = await openFile(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('File changed before it could be read');
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readRegularFileNoFollow(filePath: string): Promise<Buffer> {
  const opened = await openRegularFileNoFollow(filePath);
  try { return await opened.readFile(); }
  finally { await opened.close(); }
}

export function isSafeThumbnailCacheFilePath(filePath: string, thumbnailDir: string): boolean {
  if (!isPathContained(thumbnailDir, filePath) || !isRegularNonSymlinkFilePath(filePath)) return false;
  try {
    const directory = fs.lstatSync(thumbnailDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return false;
    return isPathContained(fs.realpathSync(thumbnailDir), fs.realpathSync(filePath));
  } catch {
    return false;
  }
}

export function resolveAllowedPolytrayLocalFilePath(
  requestUrl: string,
  policy: LocalFilePolicy,
): string | null {
  const filePath = decodePolytrayLocalFilePath(requestUrl);
  if (!filePath) {
    return null;
  }

  return isAllowedLocalFilePath(filePath, policy) ? filePath : null;
}
