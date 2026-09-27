import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { Open } from 'unzipper';
import type { SlicerConfiguration, SlicerHandoffRequest, SlicerHandoffResult } from '../shared/backupContracts';
import { ARCHIVE_ENTRY_SEPARATOR } from '../shared/archivePaths';

export type SlicerPlatform = 'win32' | 'darwin' | 'linux';
export interface IndexedHandoffFile { id: number; contentRevision: number; path: string; extension: string }
interface Dependencies {
  userDataPath: string;
  platform: SlicerPlatform;
  lookupIndexedFile(path: string): IndexedHandoffFile | null;
  launch(configuration: SlicerConfiguration, modelPath: string, guard?: () => 'cancelled' | 'stale' | null): Promise<void>;
  validateApplication?(configuration: SlicerConfiguration): Promise<boolean>;
  afterPreparation?(): Promise<void>;
  afterOutputOpen?(): void;
  createOutputPath?(): string;
  removeOwnedFile?(filePath: string): Promise<void>;
  onEntryChunk?: () => void;
  maxUncompressedBytes?: number;
}

const supported = new Set(['stl', 'obj', '3mf']);
const maxDefault = 1024 * 1024 * 1024;
const isAbsoluteForPlatform = (value: string, platform: SlicerPlatform) =>
  platform === 'win32' ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);

export function normalizeSlicerConfiguration(value: unknown, platform: SlicerPlatform): SlicerConfiguration | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SlicerConfiguration>;
  if (candidate.useSystemDefault === true && candidate.applicationPath === null) return { useSystemDefault: true, applicationPath: null };
  if (candidate.useSystemDefault !== false || typeof candidate.applicationPath !== 'string' || !candidate.applicationPath.trim()) return null;
  if (!isAbsoluteForPlatform(candidate.applicationPath, platform)) return null;
  if (platform === 'win32' && !/\.exe$/i.test(candidate.applicationPath)) return null;
  if (platform === 'darwin' && !candidate.applicationPath.toLowerCase().endsWith('.app')) return null;
  return { useSystemDefault: false, applicationPath: candidate.applicationPath };
}

export interface SpawnAdapter {
  (executable: string, args: string[], waitForExit: boolean): Promise<void>;
}
export interface PlatformAdapters {
  spawn: SpawnAdapter;
  openDefault(filePath: string, guard?: LaunchGuard): Promise<void>;
  canExecute?(filePath: string): Promise<boolean>;
  isMacApplicationBundle?(bundlePath: string): Promise<boolean>;
  isWindowsExecutable?(exePath: string): Promise<boolean>;
}
type LaunchGuard = () => 'cancelled' | 'stale' | null;
function assertLaunchAllowed(guard?: LaunchGuard) {
  const result = guard?.();
  if (result === 'cancelled') throw new Error('launch-cancelled');
  if (result === 'stale') throw new Error('indexed-identity-changed');
}

const defaultSpawn: SpawnAdapter = (executable, args, waitForExit) => new Promise((resolve, reject) => {
  const child: ChildProcess = nodeSpawn(executable, args, { shell: false, stdio: 'ignore', windowsHide: true });
  child.once('error', reject);
  child.once('spawn', () => { if (!waitForExit) resolve(); });
  if (waitForExit) child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Launcher exited ${signal ? `from ${signal}` : `with code ${code}`}`)));
});

export function getLaunchInvocation(platform: SlicerPlatform, applicationPath: string, modelPath: string) {
  return platform === 'darwin'
    ? { executable: '/usr/bin/open', args: ['-a', applicationPath, '--', modelPath], waitForExit: true }
    : { executable: applicationPath, args: [modelPath], waitForExit: false };
}

export function createPlatformLauncher(platform: SlicerPlatform, adapters: Partial<PlatformAdapters> = {}) {
  const spawn = adapters.spawn ?? defaultSpawn;
  const openDefault = adapters.openDefault ?? (async (filePath: string, guard?: LaunchGuard) => {
    const { shell } = await import('electron');
    assertLaunchAllowed(guard);
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  });
  const canExecute = adapters.canExecute ?? (async (filePath: string) => {
    try { const stat = await fsp.lstat(filePath); if (stat.isSymbolicLink() || !stat.isFile()) return false; await fsp.access(filePath, fs.constants.X_OK); return true; } catch { return false; }
  });
  const isMacApplicationBundle = adapters.isMacApplicationBundle ?? (async (bundlePath: string) => fsp.lstat(bundlePath).then(stat => stat.isDirectory() && !stat.isSymbolicLink()).catch(() => false));
  const isWindowsExecutable = adapters.isWindowsExecutable ?? (async (exePath: string) => fsp.lstat(exePath).then(stat => stat.isFile() && !stat.isSymbolicLink() && path.win32.extname(exePath).toLowerCase() === '.exe').catch(() => false));
  return async (configuration: SlicerConfiguration, modelPath: string, guard?: LaunchGuard) => {
    if (configuration.useSystemDefault) return openDefault(modelPath, guard);
    const applicationPath = configuration.applicationPath;
    if (!applicationPath) throw new Error('A slicer application has not been selected.');
    if (platform === 'linux' && !(await canExecute(applicationPath))) throw new Error('Selected Linux application is not a regular executable file.');
    if (platform === 'darwin' && !(await isMacApplicationBundle(applicationPath))) throw new Error('Selected macOS application bundle is unavailable.');
    if (platform === 'win32' && !(await isWindowsExecutable(applicationPath))) throw new Error('Selected Windows application is not a regular executable file.');
    assertLaunchAllowed(guard);
    const invocation = getLaunchInvocation(platform, applicationPath, modelPath);
    await spawn(invocation.executable, invocation.args, invocation.waitForExit);
  };
}

export function createSlicerHandoff(deps: Dependencies) {
  const handoffDir = path.join(deps.userDataPath, 'slicer-handoff');
  async function ensureHandoffDirectory(create = true) {
    if (create) await fsp.mkdir(handoffDir, { recursive: true });
    const stat = await fsp.lstat(handoffDir).catch(() => null);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error('unsafe-archive-entry');
  }
  async function prepareArchive(archivePath: string, entryPath: string, extension: string, signal?: AbortSignal) {
    await ensureHandoffDirectory();
    if (signal?.aborted) throw new Error('cancelled');
    const outputPath = deps.createOutputPath?.() ?? path.join(handoffDir, `${crypto.randomUUID()}.${extension}`);
    if (path.resolve(path.dirname(outputPath)) !== path.resolve(handoffDir)) throw new Error('unsafe-archive-entry');
    let owned = false;
    let output: fs.WriteStream | null = null;
    let sourceHandle: fsp.FileHandle | null = null;
    try {
      const before = await fsp.lstat(archivePath).catch(() => null);
      if (!before?.isFile() || before.isSymbolicLink()) throw new Error('missing-source');
      const noFollow = (fs.constants as typeof fs.constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
      sourceHandle = await fsp.open(archivePath, fs.constants.O_RDONLY | noFollow).catch(() => null);
      if (!sourceHandle) throw new Error('missing-source');
      const opened = await sourceHandle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('missing-source');
      const directory = await Open.custom({
        size: async () => opened.size,
        stream: (offset, length) => Readable.from((async function* () {
          const chunkSize = 64 * 1024;
          const end = length ? Math.min(offset + length, opened.size) : opened.size;
          for (let position = offset; position < end; position += chunkSize) {
            const data = Buffer.alloc(Math.min(chunkSize, end - position));
            const { bytesRead } = await sourceHandle!.read(data, 0, data.length, position);
            if (!bytesRead) break;
            yield data.subarray(0, bytesRead);
          }
        })()),
      }).catch(() => { throw new Error('unsafe-archive-entry'); });
      const entry = directory.files.find(item => item.path === entryPath);
      if (!entry || entry.type !== 'File' || entry.path !== entryPath || path.posix.isAbsolute(entryPath) || entryPath.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('unsafe-archive-entry');
      if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('unsafe-archive-entry');
      if (path.posix.extname(entry.path).slice(1).toLowerCase() !== extension) throw new Error('unsafe-archive-entry');
      if (entry.uncompressedSize > (deps.maxUncompressedBytes ?? maxDefault)) throw new Error('size-limit');
      if (signal?.aborted) throw new Error('cancelled');
      output = fs.createWriteStream(outputPath, { flags: 'wx' });
      await new Promise<void>((resolve, reject) => {
        output!.once('open', () => { owned = true; resolve(); });
        output!.once('error', reject);
      });
      deps.afterOutputOpen?.();
      if (signal?.aborted) throw new Error('cancelled');
      let total = 0;
      const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        deps.onEntryChunk?.();
        if (total > (deps.maxUncompressedBytes ?? maxDefault)) callback(new Error('size-limit'));
        else if (signal?.aborted) callback(new Error('cancelled'));
        else callback(null, chunk);
      } });
      await pipeline(entry.stream(), counter, output, { signal });
      if (total !== entry.uncompressedSize) throw new Error('unsafe-archive-entry');
      const after = await fsp.lstat(archivePath).catch(() => null);
      if (!after?.isFile() || after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino) throw new Error('missing-source');
      return { outputPath, sourceDev: opened.dev, sourceIno: opened.ino };
    } catch (error) {
      if (owned && output && !output.closed) await new Promise<void>(resolve => { output!.once('close', resolve); output!.destroy(); });
      if (owned) await fsp.rm(outputPath, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await sourceHandle?.close().catch(() => undefined);
    }
  }
  function identityMatches(a: IndexedHandoffFile | null, request: SlicerHandoffRequest) {
    return !!a && a.id === request.fileId && a.contentRevision === request.contentRevision && a.path === request.path && a.extension.toLowerCase() === request.extension.toLowerCase();
  }
  return {
    handoffDir,
    async cleanupOldFiles(now = Date.now()) {
      let removed = 0;
      let failed = 0;
      const errors: string[] = [];
      const noteFailure = (error: unknown) => {
        failed += 1;
        if (errors.length < 3) errors.push((error instanceof Error ? error.message : String(error)).slice(0, 200));
      };
      try { await ensureHandoffDirectory(false); } catch (error) { noteFailure(error); return { removed, failed, errors }; }
      let entries: fs.Dirent[];
      try { entries = await fsp.readdir(handoffDir, { withFileTypes: true }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') noteFailure(error);
        return { removed, failed, errors };
      }
      for (const item of entries) {
        if (!item.isFile()) continue;
        const target = path.join(handoffDir, item.name);
        const stat = await fsp.lstat(target).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') noteFailure(error); return null; });
        if (!stat?.isFile() || now - stat.mtimeMs <= 24 * 60 * 60 * 1000) continue;
        try { await (deps.removeOwnedFile ?? (filePath => fsp.rm(filePath, { force: true })))(target); removed += 1; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') noteFailure(error); }
      }
      return { removed, failed, errors };
    },
    async open(request: SlicerHandoffRequest, signal?: AbortSignal): Promise<SlicerHandoffResult> {
      let outputPath: string | null = null;
      let sourceIdentity: { path: string; dev: number; ino: number } | null = null;
      try {
        if (signal?.aborted) return { status: 'cancelled' };
        const current = deps.lookupIndexedFile(request.path);
        if (!identityMatches(current, request)) return failed('missing-source', 'The indexed model changed or was removed. Rescan the library and try again.');
        if (!supported.has(request.extension.toLowerCase())) return failed('unsupported-format', 'Choose an indexed STL, OBJ, or 3MF model.');
        const configuration = normalizeSlicerConfiguration(request.configuration, deps.platform);
        if (!configuration) return failed('application-unavailable', 'Choose a slicer application or explicitly select the system default.');
        if (configuration.applicationPath && deps.validateApplication) {
          const valid = await deps.validateApplication(configuration);
          if (!valid) return failed('application-unavailable', 'The selected slicer application is unavailable or invalid. Choose it again.');
        }
        if (signal?.aborted) return { status: 'cancelled' };
        const separator = request.path.indexOf(ARCHIVE_ENTRY_SEPARATOR);
        const archive = separator > 0 ? { archivePath: request.path.slice(0, separator), entryPath: request.path.slice(separator + ARCHIVE_ENTRY_SEPARATOR.length) } : null;
        let modelPath = request.path;
        if (archive) {
          if (!isAbsoluteForPlatform(archive.archivePath, deps.platform) || !archive.entryPath || archive.entryPath.includes('\\') || archive.entryPath.startsWith('/') || /^[A-Za-z]:/.test(archive.entryPath) || archive.entryPath.split('/').some(part => part === '..' || part === '.')) return failed('unsafe-archive-entry', 'The indexed ZIP member path is unsafe.');
          if (path.posix.extname(archive.entryPath).slice(1).toLowerCase() !== request.extension.toLowerCase()) return failed('unsafe-archive-entry', 'The indexed ZIP member does not match the model format.');
          if (!await fsp.stat(archive.archivePath).then(stat => stat.isFile()).catch(() => false)) return failed('missing-source', 'The source archive is missing. Restore it and rescan the library.');
          if (signal?.aborted) return { status: 'cancelled' };
          const prepared = await prepareArchive(archive.archivePath, archive.entryPath, request.extension.toLowerCase(), signal);
          outputPath = prepared.outputPath;
          sourceIdentity = { path: archive.archivePath, dev: prepared.sourceDev, ino: prepared.sourceIno };
          modelPath = prepared.outputPath;
          await deps.afterPreparation?.();
        } else {
          if (!isAbsoluteForPlatform(request.path, deps.platform)) return failed('missing-source', 'The indexed model file path is not absolute.');
          const before = await fsp.lstat(request.path).catch(() => null);
          if (!before?.isFile() || before.isSymbolicLink()) return failed('missing-source', 'The indexed model file is missing or is no longer a regular file. Restore it and rescan the library.');
          const noFollow = (fs.constants as typeof fs.constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
          const source = await fsp.open(request.path, fs.constants.O_RDONLY | noFollow).catch(() => null);
          if (!source) return failed('missing-source', 'The indexed model file could not be opened safely.');
          const opened = await source.stat().finally(() => source.close());
          if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return failed('missing-source', 'The indexed model file changed before it could be opened.');
          sourceIdentity = { path: request.path, dev: opened.dev, ino: opened.ino };
        }
        if (signal?.aborted) throw new Error('cancelled');
        const launchGuard: LaunchGuard = () => {
          if (signal?.aborted) return 'cancelled';
          if (!identityMatches(deps.lookupIndexedFile(request.path), request)) return 'stale';
          if (sourceIdentity) {
            try {
              const current = fs.lstatSync(sourceIdentity.path);
              if (!current.isFile() || current.isSymbolicLink() || current.dev !== sourceIdentity.dev || current.ino !== sourceIdentity.ino) return 'stale';
            } catch { return 'stale'; }
          }
          return null;
        };
        assertLaunchAllowed(launchGuard);
        await deps.launch(configuration, modelPath, launchGuard);
        return { status: 'launched', handoffPath: modelPath };
      } catch (error) {
        if (outputPath) await fsp.rm(outputPath, { force: true }).catch(() => undefined);
        if (error instanceof Error && (error.name === 'AbortError' || error.message === 'cancelled' || error.message === 'launch-cancelled')) return { status: 'cancelled' };
        if (error instanceof Error && error.message === 'size-limit') return failed('size-limit', 'The selected ZIP member exceeds the 1 GiB handoff limit.');
        if (error instanceof Error && error.message === 'unsafe-archive-entry') return failed('unsafe-archive-entry', 'The ZIP is corrupt or the selected member is unsafe.');
        if (error instanceof Error && (error.message === 'missing-source' || error.message === 'indexed-identity-changed')) return failed('missing-source', 'The indexed model or source archive changed or was removed before launch. Rescan the library and try again.');
        return failed('launch-failed', 'Polytray could not open the model in the selected application. Check the application and try again.');
      }
    },
  };
}
function failed(code: Extract<SlicerHandoffResult, { status: 'failed' }>['code'], message: string): SlicerHandoffResult {
  return { status: 'failed', code, message };
}
