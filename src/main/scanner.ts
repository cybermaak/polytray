import fs from "fs";
import path from "path";
import * as unzipper from "unzipper";
import { EXT_SET } from "../shared/types";
import type { DiscoveryEvent, DiscoveredModel } from "../shared/backgroundJobs";
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

/** Stream records and positive/negative scope proof without collecting the file list. */
export async function* streamDiscoverFolder(
  rootPath: string,
  signal?: AbortSignal,
  generation = Date.now(),
): AsyncGenerator<DiscoveryEvent> {
  const cancelled = () => Boolean(signal?.aborted);
  const scopeError = (scopePath: string, code: string, reason: string, kind: 'directory' | 'archive' = 'directory'): DiscoveryEvent => ({
    type: 'scope-error', rootPath, scopePath, phase: 'discovery', code, reason, kind,
  });

  async function* walkDir(dirPath: string): AsyncGenerator<DiscoveryEvent> {
    if (cancelled()) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      if (cancelled()) return;
    } catch (error: unknown) {
      if (cancelled()) return;
      const reason = (error as Error)?.message ?? String(error);
      console.warn(`Cannot read directory ${dirPath}:`, reason);
      yield scopeError(dirPath, 'READDIR_FAILED', reason);
      return;
    }

    for (const entry of entries) {
      if (cancelled()) return;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'fixtures' && dirPath.includes(path.sep + 'tests')) {
          yield scopeError(fullPath, 'SCOPE_EXCLUDED', 'directory excluded by scan policy');
          continue;
        }
        yield* walkDir(fullPath);
        if (cancelled()) return;
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().slice(1);
        if (EXT_SET.has(ext)) {
          try {
            const stat = await fs.promises.stat(fullPath);
            if (cancelled()) return;
            const file: DiscoveredModel = {
              path: fullPath,
              directory: dirPath,
              archivePath: null,
              name: path.basename(entry.name, `.${ext}`),
              extension: ext,
              sizeBytes: stat.size,
              modifiedAt: Math.floor(stat.mtimeMs),
            };
            yield { type: 'file', rootPath, scopePath: dirPath, file };
          } catch (error: unknown) {
            if (cancelled()) return;
            const reason = (error as Error)?.message ?? String(error);
            console.warn(`Cannot stat ${fullPath}:`, reason);
            yield scopeError(fullPath, 'STAT_FAILED', reason);
          }
        } else if (ARCHIVE_EXT_SET.has(ext)) {
          yield* scanArchive(fullPath, dirPath);
          if (cancelled()) return;
        }
      }
    }
    if (cancelled()) return;
    yield { type: 'scope-complete', rootPath, scopePath: dirPath, generation, kind: 'directory' };
  }

  async function* scanArchive(archivePath: string, parentDir: string): AsyncGenerator<DiscoveryEvent> {
    try {
      const directory = await unzipper.Open.file(archivePath);
      if (cancelled()) return;
      const stat = await fs.promises.stat(archivePath);
      if (cancelled()) return;
      for (const entry of directory.files) {
        if (cancelled()) return;
        if (entry.type !== 'File' || !isSupportedArchiveEntry(entry.path)) continue;
        const virtualPath = createArchiveEntryPath(archivePath, entry.path);
        const file: DiscoveredModel = {
          path: virtualPath,
          name: getArchiveEntryBaseName(entry.path),
          extension: getArchiveEntryExtension(entry.path),
          directory: getArchiveEntryDirectory(virtualPath) || parentDir,
          archivePath,
          sizeBytes: entry.uncompressedSize,
          modifiedAt: Math.floor(stat.mtimeMs),
        };
        yield { type: 'file', rootPath, scopePath: archivePath, file };
      }
      if (!cancelled()) yield { type: 'scope-complete', rootPath, scopePath: archivePath, generation, kind: 'archive' };
    } catch (error: unknown) {
      if (cancelled()) return;
      const reason = (error as Error)?.message ?? String(error);
      console.warn(`Cannot inspect archive ${archivePath}:`, reason);
      yield scopeError(archivePath, 'ARCHIVE_FAILED', reason, 'archive');
    }
  }

  yield* walkDir(rootPath);
  yield { type: 'discovery-complete', rootPath, cancelled: cancelled() };
}

/** Compatibility collector for existing callers and scan-safety tests. */
export async function discoverFolder(rootPath: string, signal?: AbortSignal): Promise<ScanDiscovery> {
  const files: ScannedFile[] = [];
  const scopes: ScanScope[] = [];
  const errors: ScanDiscovery['errors'] = [];
  let wasCancelled = false;
  for await (const event of streamDiscoverFolder(rootPath, signal)) {
    if (event.type === 'file') {
      const { file } = event;
      files.push({ path: file.path, name: file.name, ext: file.extension, dir: file.directory,
        size: file.sizeBytes, mtime: file.modifiedAt });
    } else if (event.type === 'scope-complete') {
      scopes.push({ scopePath: event.scopePath, kind: event.kind, status: 'complete' });
    } else if (event.type === 'scope-error') {
      const excluded = event.code === 'SCOPE_EXCLUDED';
      const kind = event.kind;
      const phase: ScanScope['phase'] = event.code === 'ARCHIVE_FAILED' ? 'archive'
        : event.code === 'STAT_FAILED' ? 'stat'
          : excluded ? 'excluded' : 'readdir';
      scopes.push({ scopePath: event.scopePath, kind, status: excluded ? 'excluded' : 'error', phase, reason: event.reason });
      if (!excluded) errors.push({ scopePath: event.scopePath, phase, reason: event.reason });
    } else if (event.type === 'discovery-complete') {
      wasCancelled = event.cancelled;
    }
  }
  const incomplete = errors.length > 0 || scopes.some((scope) => scope.status !== 'complete');
  const state: ScanTerminalState = wasCancelled ? 'cancelled' : incomplete
    ? (scopes.some((scope) => scope.status === 'complete') ? 'partial' : 'failed')
    : 'completed';
  return { files, scopes, state, errors };
}
