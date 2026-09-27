import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Open } from 'unzipper';
import { ARCHIVE_ENTRY_SEPARATOR } from '../shared/archivePaths';

export type SlicerPlatform = 'win32' | 'darwin' | 'linux';
export type SlicerPlatformConfig =
  | { kind: 'default'; platform: SlicerPlatform }
  | { kind: 'application'; platform: SlicerPlatform; executablePath: string };
export type HandoffResult =
  | { status: 'opened' }
  | { status: 'cancelled' }
  | { status: 'failure'; reason: 'not-indexed' | 'unsupported-format' | 'missing-source' | 'missing-app' | 'invalid-app' | 'archive-invalid' | 'size-limit' | 'launch-failed'; action: string }
  | { status: 'preparing' };
export interface IndexedHandoffFile { path: string; extension: string }
interface Dependencies {
  userDataPath: string; platform: SlicerPlatform; lookupIndexedFile(path: string): IndexedHandoffFile | null;
  launch(config: SlicerPlatformConfig, modelPath: string): Promise<void>; onEntryChunk?: () => void; maxUncompressedBytes?: number;
  validateApplication?(config: Extract<SlicerPlatformConfig, { kind: 'application' }>): Promise<'missing-app' | 'invalid-app' | null>;
}
const supported = new Set(['stl', 'obj', '3mf']);
const maxDefault = 1024 * 1024 * 1024;

export function validateSlicerConfig(value: unknown, platform: SlicerPlatform): SlicerPlatformConfig {
  if (!value || typeof value !== 'object') throw new Error('Choose a slicer application or the system default.');
  const config = value as Record<string, unknown>;
  if (config.kind === 'default' && config.platform === platform) return { kind: 'default', platform };
  if (config.kind !== 'application' || config.platform !== platform || typeof config.executablePath !== 'string' || !config.executablePath.trim()) throw new Error('Choose a valid slicer application.');
  const selected = config.executablePath;
  if (platform === 'darwin' && !selected.toLowerCase().endsWith('.app')) throw new Error('On macOS, choose a slicer .app bundle.');
  if (platform === 'win32' && !/\.exe$/i.test(selected)) throw new Error('On Windows, choose a slicer executable (.exe).');
  return { kind: 'application', platform, executablePath: selected };
}

export async function launchSlicer(config: SlicerPlatformConfig, modelPath: string) {
  if (config.kind === 'default') {
    const { shell } = await import('electron');
    const error = await shell.openPath(modelPath);
    if (error) throw new Error(error);
    return;
  }
  if (config.platform === 'linux') {
    await fsp.access(config.executablePath, fs.constants.X_OK);
  }
  const invocation = getLaunchInvocation(config, modelPath);
  await spawn(invocation.executable, invocation.args);
}
export function getLaunchInvocation(config: Extract<SlicerPlatformConfig, { kind: 'application' }>, modelPath: string) {
  return config.platform === 'darwin'
    ? { executable: '/usr/bin/open', args: ['-a', config.executablePath, '--args', modelPath], shell: false as const }
    : { executable: config.executablePath, args: [modelPath], shell: false as const };
}
function spawn(executable: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = nodeSpawn(executable, args, { shell: false, stdio: 'ignore', windowsHide: true });
    child.once('error', reject); child.once('spawn', () => resolve());
  });
}

export function createSlicerHandoff(deps: Dependencies) {
  const handoffDir = path.join(deps.userDataPath, 'slicer-handoff');
  async function prepareArchive(archivePath: string, entryPath: string, extension: string, signal?: AbortSignal) {
    await ensureHandoffDirectory();
    const outputPath = path.join(handoffDir, `${crypto.randomUUID()}.${extension}`);
    let created = false;
    try {
      const directory = await Open.file(archivePath).catch(() => { throw new Error('archive-invalid'); });
      const entry = directory.files.find((item) => item.path === entryPath);
      if (!entry || entry.type !== 'File' || entry.path !== entryPath || path.posix.isAbsolute(entryPath) || entryPath.split(/[\\/]/).includes('..')) throw new Error('archive-invalid');
      if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('archive-invalid');
      if (path.posix.extname(entry.path).slice(1).toLowerCase() !== extension) throw new Error('archive-invalid');
      if (entry.uncompressedSize > (deps.maxUncompressedBytes ?? maxDefault)) throw new Error('size-limit');
      const output = fs.createWriteStream(outputPath, { flags: 'wx' }); created = true;
      let total = 0;
      const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length; deps.onEntryChunk?.();
        if (total > (deps.maxUncompressedBytes ?? maxDefault)) callback(new Error('size-limit'));
        else if (signal?.aborted) callback(new Error('cancelled'));
        else callback(null, chunk);
      } });
      await pipeline(entry.stream(), counter, output, { signal });
      if (total !== entry.uncompressedSize) throw new Error('archive-invalid');
      return outputPath;
    } catch (error) { if (created) await fsp.rm(outputPath, { force: true }).catch(() => undefined); throw error; }
  }
  return {
    handoffDir,
    async cleanupOldFiles(now = Date.now()) {
      await ensureHandoffDirectory(false);
      const entries = await fsp.readdir(handoffDir, { withFileTypes: true }).catch(() => []);
      for (const item of entries) { if (!item.isFile()) continue; const target = path.join(handoffDir, item.name); const stat = await fsp.stat(target).catch(() => null); if (stat && now - stat.mtimeMs > 24 * 60 * 60 * 1000) await fsp.rm(target, { force: true }); }
    },
    async open(requestedPath: string, rawConfig: unknown, signal?: AbortSignal): Promise<HandoffResult> {
      let outputPath: string | null = null;
      try {
        if (signal?.aborted) return { status: 'cancelled' };
        const config = validateSlicerConfig(rawConfig, deps.platform);
        const indexed = deps.lookupIndexedFile(requestedPath);
        if (!indexed || indexed.path !== requestedPath) return failure('not-indexed');
        const extension = indexed.extension.toLowerCase().replace(/^\./, '');
        if (!supported.has(extension)) return failure('unsupported-format');
        if (config.kind === 'application') {
          const validation = deps.validateApplication
            ? await deps.validateApplication(config)
            : await validateApplicationPath(config);
          if (validation) return failure(validation);
        }
        const separator = requestedPath.indexOf(ARCHIVE_ENTRY_SEPARATOR);
        const archive = separator > 0
          ? { archivePath: requestedPath.slice(0, separator), entryPath: requestedPath.slice(separator + ARCHIVE_ENTRY_SEPARATOR.length) }
          : null;
        let modelPath = requestedPath;
        if (archive) {
          if (!archive.entryPath || archive.entryPath.includes('\\') || archive.entryPath.startsWith('/') || /^[A-Za-z]:/.test(archive.entryPath) || archive.entryPath.split('/').some(part => part === '..' || part === '.')) return failure('archive-invalid');
          if (path.extname(archive.entryPath).slice(1).toLowerCase() !== extension) return failure('archive-invalid');
          if (!await fsp.stat(archive.archivePath).then(s => s.isFile()).catch(() => false)) return failure('missing-source');
          outputPath = await prepareArchive(archive.archivePath, archive.entryPath, extension, signal); modelPath = outputPath;
        } else if (!await fsp.stat(requestedPath).then(s => s.isFile()).catch(() => false)) return failure('missing-source');
        if (signal?.aborted) throw new Error('cancelled');
        await deps.launch(config, modelPath); outputPath = null; return { status: 'opened' };
      } catch (error) {
        if (outputPath) await fsp.rm(outputPath, { force: true }).catch(() => undefined);
        if (error instanceof Error && (error.name === 'AbortError' || error.message === 'cancelled')) return { status: 'cancelled' };
        const reason = error instanceof Error ? error.message : '';
        if (reason === 'size-limit') return failure('size-limit'); if (reason === 'archive-invalid') return failure('archive-invalid'); return failure('launch-failed');
      }
    },
  };
  async function ensureHandoffDirectory(create = true) {
    if (create) await fsp.mkdir(handoffDir, { recursive: true });
    const stat = await fsp.lstat(handoffDir).catch(() => null);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error('archive-invalid');
  }
}
async function validateApplicationPath(config: Extract<SlicerPlatformConfig, { kind: 'application' }>) {
  const stat = await fsp.stat(config.executablePath).catch(() => null);
  if (!stat) return 'missing-app' as const;
  if (config.platform === 'linux' && !(stat.mode & 0o111)) return 'invalid-app' as const;
  if (config.platform === 'darwin' && !stat.isDirectory()) return 'invalid-app' as const;
  if (config.platform === 'win32' && !stat.isFile()) return 'invalid-app' as const;
  return null;
}
function failure(reason: Extract<HandoffResult, { status: 'failure' }>['reason']): HandoffResult {
  const actions: Record<typeof reason, string> = {
    'not-indexed': 'Rescan the library, then try again.', 'unsupported-format': 'Choose an indexed STL, OBJ, or 3MF model.',
    'missing-source': 'Restore the model or archive, then rescan the library.', 'missing-app': 'Choose an installed slicer or use the system default.',
    'invalid-app': 'Choose a runnable slicer application.', 'archive-invalid': 'Check that the archive contains the indexed model entry.',
    'size-limit': 'Choose a ZIP entry smaller than 1 GiB.', 'launch-failed': 'Check the slicer selection and try again.',
  };
  return { status: 'failure', reason, action: actions[reason] };
}
