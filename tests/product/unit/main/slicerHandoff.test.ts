import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createPlatformLauncher, createSlicerHandoff, getLaunchInvocation, normalizeSlicerConfiguration, type IndexedHandoffFile, type SlicerPlatform } from '../../../../src/main/slicerHandoff';
import type { SlicerConfiguration, SlicerHandoffRequest } from '../../../../src/shared/backupContracts';

const config: SlicerConfiguration = { applicationPath: '/tmp/slicer "α"', useSystemDefault: false };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-slicer-'));
  const archivePath = path.join(root, 'models.zip');
  const zip = new JSZip();
  zip.file('parts/模型.stl', 'solid exact');
  await fs.writeFile(archivePath, await zip.generateAsync({ type: 'nodebuffer' }));
  const virtualPath = `${archivePath}::entry::parts/模型.stl`;
  const request: SlicerHandoffRequest = { requestId: 'req-1', fileId: 7, contentRevision: 3, path: virtualPath, extension: 'stl', configuration: config };
  return { root, archivePath, virtualPath, request };
}

function service(root: string, identity: () => IndexedHandoffFile | null, launch: (config: SlicerConfiguration, path: string) => Promise<void>, extra: Partial<Parameters<typeof createSlicerHandoff>[0]> = {}) {
  return createSlicerHandoff({ userDataPath: root, platform: 'linux', lookupIndexedFile: () => identity(), launch, ...extra });
}
const indexed = (request: SlicerHandoffRequest): IndexedHandoffFile => ({ id: request.fileId, contentRevision: request.contentRevision, path: request.path, extension: request.extension });

test('extracts only the exact indexed archive member and retains the successful output', async () => {
  const f = await fixture();
  let launchedPath = '';
  const result = await service(f.root, () => indexed(f.request), async (_configuration, modelPath) => { launchedPath = modelPath; }).open(f.request);
  assert.equal(result.status, 'launched', JSON.stringify(result));
  assert.equal(await fs.readFile(launchedPath, 'utf8'), 'solid exact');
  assert.equal(await fs.readFile(f.archivePath).then(bytes => bytes.length > 0), true);
  assert.equal(path.extname(launchedPath), '.stl');
  assert.equal(path.dirname(launchedPath), path.join(f.root, 'slicer-handoff'));
  await fs.rm(f.root, { recursive: true, force: true });
});

test('passes regular model paths intact and rejects missing or symlink-replaced sources', async () => {
  const f = await fixture();
  const model = path.join(f.root, 'regular model.stl');
  await fs.writeFile(model, 'regular');
  const request = { ...f.request, path: model };
  let launched = '';
  const ok = await service(f.root, () => indexed(request), async (_configuration, modelPath) => { launched = modelPath; }).open(request);
  assert.equal(ok.status, 'launched');
  assert.equal(launched, model);
  await fs.unlink(model);
  const target = path.join(f.root, 'outside.stl'); await fs.writeFile(target, 'outside');
  await fs.symlink(target, model);
  const rejected = await service(f.root, () => indexed(request), async () => assert.fail('symlink source must not launch')).open(request);
  assert.equal(rejected.status, 'failed');
  assert.equal(await fs.readFile(target, 'utf8'), 'outside');
  await fs.rm(f.root, { recursive: true, force: true });
});

test('revalidates id, revision, path, and extension after archive preparation before launch', async () => {
  const replacements: Array<IndexedHandoffFile | null | ((original: IndexedHandoffFile) => IndexedHandoffFile)> = [
    null,
    original => ({ ...original, id: 8 }),
    original => ({ ...original, contentRevision: 4 }),
    original => ({ ...original, path: '/replacement/model.stl' }),
    original => ({ ...original, extension: 'obj' }),
  ];
  for (const replacement of replacements) {
    const f = await fixture();
    let row: IndexedHandoffFile | null = indexed(f.request);
    let release!: () => void;
    let notifyPreparation!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { notifyPreparation = resolve; });
    let launches = 0;
    const handoff = service(f.root, () => row, async () => { launches += 1; }, { afterPreparation: () => { notifyPreparation(); return barrier; } });
    const pending = handoff.open(f.request);
    await entered;
    row = typeof replacement === 'function' ? replacement(indexed(f.request)) : replacement;
    release();
    const result = await pending;
    assert.equal(result.status, 'failed');
    assert.equal(launches, 0);
    assert.deepEqual(await fs.readdir(path.join(f.root, 'slicer-handoff')), []);
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('final launch guard catches cancellation or revision changes during async app validation', async () => {
  for (const change of ['cancel', 'revision'] as const) {
    const f = await fixture();
    let row: IndexedHandoffFile | null = indexed(f.request);
    let enterValidation!: () => void;
    let releaseValidation!: () => void;
    const entered = new Promise<void>(resolve => { enterValidation = resolve; });
    const barrier = new Promise<void>(resolve => { releaseValidation = resolve; });
    let spawnCount = 0;
    const launcher = createPlatformLauncher('linux', {
      canExecute: async () => { enterValidation(); await barrier; return true; },
      spawn: async () => { spawnCount += 1; },
    });
    const abort = new AbortController();
    const pending = service(f.root, () => row, launcher, { validateApplication: async () => true }).open(f.request, abort.signal);
    await entered;
    if (change === 'cancel') abort.abort();
    else row = { ...indexed(f.request), contentRevision: 10 };
    releaseValidation();
    const result = await pending;
    assert.equal(result.status, change === 'cancel' ? 'cancelled' : 'failed');
    assert.equal(spawnCount, 0);
    assert.deepEqual(await fs.readdir(path.join(f.root, 'slicer-handoff')), []);
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('rejects an archive replaced by a symlink after extraction and removes the partial handoff', async () => {
  const f = await fixture();
  const target = path.join(f.root, 'target.zip');
  await fs.copyFile(f.archivePath, target);
  const handoff = service(f.root, () => indexed(f.request), async () => assert.fail('replaced source must not launch'), {
    afterPreparation: async () => { await fs.rename(f.archivePath, `${f.archivePath}.old`); await fs.symlink(target, f.archivePath); },
  });
  const result = await handoff.open(f.request);
  assert.equal(result.status, 'failed');
  assert.equal(await fs.readFile(target).then(bytes => bytes.length > 0), true);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'slicer-handoff')), []);
  await fs.rm(f.root, { recursive: true, force: true });
});

test('exclusive output collision never removes an existing file', async () => {
  const f = await fixture();
  const handoffDir = path.join(f.root, 'slicer-handoff'); await fs.mkdir(handoffDir);
  const collision = path.join(handoffDir, 'collision.stl'); await fs.writeFile(collision, 'keep');
  const result = await service(f.root, () => indexed(f.request), async () => {}, { createOutputPath: () => collision }).open(f.request);
  assert.equal(result.status, 'failed');
  assert.equal(await fs.readFile(collision, 'utf8'), 'keep');
  await fs.rm(f.root, { recursive: true, force: true });
});

test('cancellation before preparation and while streaming leaves no partial output', async () => {
  const f = await fixture();
  const controller = new AbortController(); controller.abort();
  const preCancelled = await service(f.root, () => indexed(f.request), async () => assert.fail('pre-cancelled handoff must not launch')).open(f.request, controller.signal);
  assert.equal(preCancelled.status, 'cancelled');
  const during = new AbortController();
  const cancelled = await service(f.root, () => indexed(f.request), async () => assert.fail('cancelled handoff must not launch'), { onEntryChunk: () => during.abort() }).open(f.request, during.signal);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(await fs.readdir(path.join(f.root, 'slicer-handoff')), []);
  const duringOpen = new AbortController();
  const openCancelled = await service(f.root, () => indexed(f.request), async () => assert.fail('cancelled opened output must not launch'), { afterOutputOpen: () => duringOpen.abort() }).open(f.request, duringOpen.signal);
  assert.equal(openCancelled.status, 'cancelled');
  assert.deepEqual(await fs.readdir(path.join(f.root, 'slicer-handoff')), []);
  await fs.rm(f.root, { recursive: true, force: true });
});

test('bounds actual uncompressed bytes, rejects corrupt and unsafe ZIP entries', async () => {
  const f = await fixture();
  const lyingZip = await fs.readFile(f.archivePath);
  const localHeader = lyingZip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const centralHeader = lyingZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  lyingZip.writeUInt32LE(1, localHeader + 22);
  lyingZip.writeUInt32LE(1, centralHeader + 24);
  await fs.writeFile(f.archivePath, lyingZip);
  const oversized = await service(f.root, () => indexed(f.request), async () => assert.fail('oversized handoff must not launch'), { maxUncompressedBytes: 5 }).open(f.request);
  assert.equal(oversized.status, 'failed');
  if (oversized.status === 'failed') assert.equal(oversized.code, 'size-limit');
  const zip = new JSZip(); zip.file('../escape.stl', 'bad'); zip.file('link.stl', 'target', { unixPermissions: '120777' });
  const badPath = path.join(f.root, 'bad.zip'); await fs.writeFile(badPath, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
  for (const entryPath of ['../escape.stl', 'link.stl']) {
    const request = { ...f.request, path: `${badPath}::entry::${entryPath}` };
    const result = await service(f.root, () => indexed(request), async () => assert.fail('unsafe entry must not launch')).open(request);
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') assert.equal(result.code, 'unsafe-archive-entry');
  }
  const corruptPath = path.join(f.root, 'corrupt.zip'); await fs.writeFile(corruptPath, 'not zip');
  const corruptRequest = { ...f.request, path: `${corruptPath}::entry::part.stl` };
  const corrupt = await service(f.root, () => indexed(corruptRequest), async () => {}).open(corruptRequest);
  assert.equal(corrupt.status, 'failed');
  await fs.rm(f.root, { recursive: true, force: true });
});

test('uses one model argument across platforms and waits for macOS open failures', async () => {
  const model = `- /models/猫's "part".stl`;
  assert.deepEqual(getLaunchInvocation('win32', 'C:\\Apps\\Slicer.exe', model), { executable: 'C:\\Apps\\Slicer.exe', args: [model], waitForExit: false });
  assert.deepEqual(getLaunchInvocation('linux', '/opt/slicer', model), { executable: '/opt/slicer', args: [model], waitForExit: false });
  assert.deepEqual(getLaunchInvocation('darwin', '/Applications/Slicer.app', model), { executable: '/usr/bin/open', args: ['-a', '/Applications/Slicer.app', '--', model], waitForExit: true });
  let invocation: unknown;
  const launcher = createPlatformLauncher('darwin', {
    isMacApplicationBundle: async () => true,
    spawn: async (executable, args, waitForExit) => { invocation = { executable, args, waitForExit }; throw new Error('open exited with code 1'); },
  });
  await assert.rejects(() => launcher({ applicationPath: '/Applications/Slicer.app', useSystemDefault: false }, model), /code 1/);
  assert.deepEqual(invocation, { executable: '/usr/bin/open', args: ['-a', '/Applications/Slicer.app', '--', model], waitForExit: true });
  const linuxLauncher = createPlatformLauncher('linux', { canExecute: async () => false, spawn: async () => assert.fail('non-executable files must not spawn') });
  await assert.rejects(() => linuxLauncher({ applicationPath: '/opt/slicer-dir', useSystemDefault: false }, model), /regular executable/);
  const windowsLauncher = createPlatformLauncher('win32', { isWindowsExecutable: async () => false, spawn: async () => assert.fail('non-executable files must not spawn') });
  await assert.rejects(() => windowsLauncher({ applicationPath: 'C:\\Apps\\slicer.exe', useSystemDefault: false }, model), /regular executable/);
  let fallbackPath = '';
  const defaultLauncher = createPlatformLauncher('linux', { openDefault: async filePath => { fallbackPath = filePath; } });
  await defaultLauncher({ applicationPath: null, useSystemDefault: true }, model);
  assert.equal(fallbackPath, model);
});

test('normalizes only explicit app or system-default selections with absolute paths', () => {
  assert.deepEqual(normalizeSlicerConfiguration({ applicationPath: '/opt/slicer', useSystemDefault: false }, 'linux'), { applicationPath: '/opt/slicer', useSystemDefault: false });
  assert.deepEqual(normalizeSlicerConfiguration({ applicationPath: null, useSystemDefault: true }, 'linux'), { applicationPath: null, useSystemDefault: true });
  assert.equal(normalizeSlicerConfiguration({ applicationPath: 'slicer', useSystemDefault: false }, 'linux'), null);
  assert.equal(normalizeSlicerConfiguration({ applicationPath: 'C:\\Apps\\slicer.bat', useSystemDefault: false }, 'win32'), null);
  assert.equal(normalizeSlicerConfiguration({ applicationPath: '/Applications/Slicer', useSystemDefault: false }, 'darwin'), null);
});

test('requires an explicit normalized application or system-default choice', async () => {
  const f = await fixture();
  const request = { ...f.request, configuration: null };
  const result = await service(f.root, () => indexed(request), async () => assert.fail('unset selection must not launch')).open(request);
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.equal(result.code, 'application-unavailable');
  await fs.rm(f.root, { recursive: true, force: true });
});

test('startup cleanup prunes only stale regular files inside the owned directory', async () => {
  const f = await fixture();
  const handoffDir = path.join(f.root, 'slicer-handoff'); await fs.mkdir(handoffDir);
  const stale = path.join(handoffDir, 'stale.stl'); const fresh = path.join(handoffDir, 'fresh.stl');
  await fs.writeFile(stale, 'old'); await fs.writeFile(fresh, 'new'); await fs.utimes(stale, new Date(0), new Date(0));
  const outside = path.join(f.root, 'outside.stl'); await fs.writeFile(outside, 'keep');
  await service(f.root, () => null, async () => {}).cleanupOldFiles();
  assert.deepEqual(await fs.readdir(handoffDir), ['fresh.stl']);
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
  await fs.rm(f.root, { recursive: true, force: true });
});

test('startup cleanup treats an absent fresh-install handoff directory as a clean result', async () => {
  const f = await fixture();
  const result = await service(f.root, () => null, async () => {}).cleanupOldFiles();
  assert.deepEqual(result, { removed: 0, failed: 0, errors: [] });
  assert.equal(await fs.stat(path.join(f.root, 'slicer-handoff')).then(() => true).catch(() => false), false);
  await fs.rm(f.root, { recursive: true, force: true });
});

test('startup cleanup keeps going after delete failures and bounds its error sample', async () => {
  const f = await fixture();
  const handoffDir = path.join(f.root, 'slicer-handoff'); await fs.mkdir(handoffDir);
  for (let index = 0; index < 5; index += 1) {
    const stale = path.join(handoffDir, `stale-${index}.stl`);
    await fs.writeFile(stale, 'old'); await fs.utimes(stale, new Date(0), new Date(0));
  }
  const result = await service(f.root, () => null, async () => {}, {
    removeOwnedFile: async filePath => { throw new Error(`cannot remove ${path.basename(filePath)}`); },
  }).cleanupOldFiles();
  assert.deepEqual(result, {
    removed: 0,
    failed: 5,
    errors: ['cannot remove stale-0.stl', 'cannot remove stale-1.stl', 'cannot remove stale-2.stl'],
  });
  assert.equal((await fs.readdir(handoffDir)).length, 5);
  await fs.rm(f.root, { recursive: true, force: true });
});

test('configuration preserves paths with spaces, quotes, leading dashes, and Unicode as one value', () => {
  const pathValue = '/Applications/--Slicer "猫".app';
  assert.deepEqual(normalizeSlicerConfiguration({ applicationPath: pathValue, useSystemDefault: false }, 'darwin'), { applicationPath: pathValue, useSystemDefault: false });
});
