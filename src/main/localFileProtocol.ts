import { pathToFileURL } from 'node:url';

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
    return true;
  }

  return policy.isIndexedFilePath(filePath);
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
