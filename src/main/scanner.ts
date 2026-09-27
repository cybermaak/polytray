import fs from "fs";
import path from "path";
import * as unzipper from "unzipper";
import { EXT_SET } from "../shared/types";
import {
  ARCHIVE_EXT_SET,
  createArchiveEntryPath,
  getArchiveEntryBaseName,
  getArchiveEntryDirectory,
  getArchiveEntryExtension,
  isSupportedArchiveEntry,
} from "../shared/archivePaths";
import { ScanScope, ScanTerminalState } from "./scanCoverage";

interface ScannedFile {
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime: number;
}

/**
 * Recursively scans a directory for 3D files.
 * @param {string} rootPath - Root directory to scan
 */
export async function scanFolder(rootPath: string): Promise<ScannedFile[]> {
  return (await discoverFolder(rootPath)).files;
}

export interface ScanDiscovery {
  files: ScannedFile[];
  scopes: ScanScope[];
  state: ScanTerminalState;
  errors: Array<{ scopePath: string; phase: string; reason: string }>;
}

export async function discoverFolder(rootPath: string, signal?: AbortSignal): Promise<ScanDiscovery> {
  const files: ScannedFile[] = [];
  const scopes: ScanScope[] = [];
  const errors: ScanDiscovery['errors'] = [];
  let cancelled = false;
  const addError = (scopePath: string, kind: 'directory' | 'archive', phase: ScanScope['phase'], error: unknown) => {
    const reason = (error as Error)?.message ?? String(error);
    scopes.push({ scopePath, kind, status: 'error', phase, reason });
    errors.push({ scopePath, phase: phase ?? 'unknown', reason });
  };
  const walkDir = async (dirPath: string): Promise<void> => {
    if (signal?.aborted) { cancelled = true; return; }
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    if (signal?.aborted) { cancelled = true; return; }
  } catch (e: unknown) {
    if (signal?.aborted) { cancelled = true; return; }
    console.warn(`Cannot read directory ${dirPath}:`, (e as Error).message);
    addError(dirPath, 'directory', 'readdir', e);
    return;
  }

  for (const entry of entries) {
    if (signal?.aborted) { cancelled = true; return; }
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Skip tests/fixtures directory
      if (entry.name === "fixtures" && dirPath.includes(path.sep + "tests")) {
        const excludedPath = path.join(dirPath, entry.name);
        scopes.push({ scopePath: excludedPath, kind: 'directory', status: 'excluded', phase: 'excluded', reason: 'directory excluded by scan policy' });
        continue;
      }
      await walkDir(fullPath);
      if (cancelled) return;
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase().slice(1);
      if (EXT_SET.has(ext)) {
        try {
          const stat = await fs.promises.stat(fullPath);
          if (signal?.aborted) { cancelled = true; return; }
          files.push({
            path: fullPath,
            name: path.basename(entry.name, "." + ext),
            ext,
            dir: dirPath,
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs),
          });
        } catch (e: unknown) {
          if (signal?.aborted) { cancelled = true; return; }
          console.warn(`Cannot stat ${fullPath}:`, (e as Error).message);
          addError(fullPath, 'directory', 'stat', e);
        }
      } else if (ARCHIVE_EXT_SET.has(ext)) {
        const archiveResult = await scanArchive(fullPath, dirPath, files, scopes, errors, signal);
        if (archiveResult === 'cancelled') { cancelled = true; return; }
      }
    }
  }
    if (signal?.aborted) { cancelled = true; return; }
    scopes.push({ scopePath: dirPath, kind: 'directory', status: 'complete' });
  };
  await walkDir(rootPath);
  const incomplete = errors.length > 0 || scopes.some((scope) => scope.status !== 'complete');
  const state: ScanTerminalState = cancelled ? 'cancelled' : incomplete ? (scopes.some((scope) => scope.status === 'complete') ? 'partial' : 'failed') : 'completed';
  return { files, scopes, state, errors };
}

async function scanArchive(
  archivePath: string,
  parentDir: string,
  results: ScannedFile[],
  scopes: ScanScope[],
  errors: ScanDiscovery['errors'],
  signal?: AbortSignal,
): Promise<'completed' | 'failed' | 'cancelled'> {
  try {
    const directory = await unzipper.Open.file(archivePath);
    if (signal?.aborted) return 'cancelled';
    const stat = await fs.promises.stat(archivePath);
    if (signal?.aborted) return 'cancelled';

    for (const entry of directory.files) {
      if (signal?.aborted) return 'cancelled';
      if (entry.type !== "File" || !isSupportedArchiveEntry(entry.path)) {
        continue;
      }

      const virtualPath = createArchiveEntryPath(archivePath, entry.path);
      results.push({
        path: virtualPath,
        name: getArchiveEntryBaseName(entry.path),
        ext: getArchiveEntryExtension(entry.path),
        dir: getArchiveEntryDirectory(virtualPath) || parentDir,
        size: entry.uncompressedSize,
        mtime: Math.floor(stat.mtimeMs),
      });
    }
    if (signal?.aborted) return 'cancelled';
    scopes.push({ scopePath: archivePath, kind: 'archive', status: 'complete' });
    return 'completed';
  } catch (e: unknown) {
    if (signal?.aborted) return 'cancelled';
    console.warn(`Cannot inspect archive ${archivePath}:`, (e as Error).message);
    const reason = (e as Error)?.message ?? String(e);
    scopes.push({ scopePath: archivePath, kind: 'archive', status: 'error', phase: 'archive', reason });
    errors.push({ scopePath: archivePath, phase: 'archive', reason });
    return 'failed';
  }
}
