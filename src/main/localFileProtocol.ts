import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

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

export function toAllowedLocalFileUrl(
  requestUrl: string,
  policy: LocalFilePolicy,
): string | null {
  const filePath = resolveAllowedPolytrayLocalFilePath(requestUrl, policy);
  if (!filePath) {
    return null;
  }

  return pathToFileURL(filePath).toString();
}
