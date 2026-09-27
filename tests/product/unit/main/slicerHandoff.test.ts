import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createSlicerHandoff, getLaunchInvocation, validateSlicerConfig, type SlicerPlatformConfig } from '../../../../src/main/slicerHandoff';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-slicer-'));
  const archivePath = path.join(root, 'models.zip');
  const zip = new JSZip();
  zip.file('parts/模型.stl', 'solid test');
  await fs.writeFile(archivePath, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
  const virtualPath = `${archivePath}::entry::parts/模型.stl`;
  return { root, archivePath, virtualPath };
}

const linuxConfig: SlicerPlatformConfig = { kind: 'application', platform: 'linux', executablePath: '/tmp/slicer "α"' };

test('prepares one exact archive member and launches with a separate Unicode path argument', async () => {
  const f = await fixture();
  const launches: string[][] = [];
  const service = createSlicerHandoff({
    userDataPath: f.root,
    platform: 'linux',
    lookupIndexedFile: (filePath) => filePath === f.virtualPath ? { path: f.virtualPath, extension: 'stl' } : null,
    launch: async (config, modelPath) => { launches.push([config.executablePath, modelPath]); },
    validateApplication: async () => null,
  });
  const result = await service.open(f.virtualPath, linuxConfig);
  assert.equal(result.status, 'opened');
  assert.equal(launches.length, 1);
  assert.equal(launches[0][0], linuxConfig.executablePath);
  const output = launches[0][1];
  assert.match(output, /\.stl$/);
  assert.equal(await fs.readFile(output, 'utf8'), 'solid test');
  assert.equal(await fs.readFile(f.archivePath).then(b => b.length > 0), true);
  await fs.rm(f.root, { recursive: true, force: true });
});

test('rejects an unindexed path before filesystem access or launch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-slicer-'));
  let launched = false;
  const service = createSlicerHandoff({ userDataPath: root, platform: 'linux', lookupIndexedFile: () => null, launch: async () => { launched = true; }, validateApplication: async () => null });
  const result = await service.open('/does/not/exist.stl', linuxConfig);
  assert.equal(result.status, 'failure');
  assert.equal(launched, false);
  await fs.rm(root, { recursive: true, force: true });
});

test('reports missing source, missing application, corrupt archive, and launch failures clearly', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-slicer-'));
  const regular = path.join(root, 'gone.stl');
  const makeService = (lookup: (p: string) => { path: string; extension: string } | null, launch: (c: SlicerPlatformConfig, p: string) => Promise<void>, validateApplication?: () => Promise<'missing-app' | 'invalid-app' | null>) => createSlicerHandoff({ userDataPath: root, platform: 'linux', lookupIndexedFile: lookup, launch, validateApplication });
  const missing = await makeService(p => ({ path: p, extension: 'stl' }), async () => {}, async () => null).open(regular, linuxConfig);
  assert.equal(missing.status, 'failure');
  assert.equal((missing as { reason?: string }).reason, 'missing-source');
  const missingApp = await makeService(p => ({ path: p, extension: 'stl' }), async () => {}, async () => 'missing-app').open(regular, linuxConfig);
  assert.equal((missingApp as { reason?: string }).reason, 'missing-app');
  const archivePath = path.join(root, 'bad.zip'); await fs.writeFile(archivePath, 'not a zip');
  const virtualPath = `${archivePath}::entry::part.stl`;
  const corrupt = await makeService(p => ({ path: p, extension: 'stl' }), async () => {}, async () => null).open(virtualPath, linuxConfig);
  assert.equal((corrupt as { reason?: string }).reason, 'archive-invalid');
  await fs.writeFile(regular, 'model');
  const launchFailure = await makeService(p => ({ path: p, extension: 'stl' }), async () => { throw new Error('platform denied'); }, async () => null).open(regular, linuxConfig);
  assert.equal((launchFailure as { reason?: string }).reason, 'launch-failed');
  await fs.rm(root, { recursive: true, force: true });
});

test('removes partial output when archive extraction is cancelled', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const service = createSlicerHandoff({
    userDataPath: f.root,
    platform: 'linux',
    lookupIndexedFile: () => ({ path: f.virtualPath, extension: 'stl' }),
    launch: async () => { throw new Error('must not launch'); },
    validateApplication: async () => null,
    onEntryChunk: () => controller.abort(),
  });
  const result = await service.open(f.virtualPath, linuxConfig, controller.signal);
  assert.equal(result.status, 'cancelled');
  const handoffDir = path.join(f.root, 'slicer-handoff');
  assert.deepEqual(await fs.readdir(handoffDir).catch(() => []), []);
  await fs.rm(f.root, { recursive: true, force: true });
});

test('validates executable argument as a path without shell parsing', () => {
  assert.deepEqual(linuxConfig, { kind: 'application', platform: 'linux', executablePath: '/tmp/slicer "α"' });
});

test('keeps model paths as one argument on Windows and Linux and uses open argument arrays for macOS', () => {
  const model = `- /models/猫's "part".stl`;
  const windows = getLaunchInvocation({ kind: 'application', platform: 'win32', executablePath: 'C:\\Apps\\Slicer.exe' }, model);
  const linux = getLaunchInvocation(linuxConfig, model);
  const mac = getLaunchInvocation({ kind: 'application', platform: 'darwin', executablePath: '/Applications/Slicer.app' }, model);
  assert.deepEqual(windows, { executable: 'C:\\Apps\\Slicer.exe', args: [model], shell: false });
  assert.deepEqual(linux, { executable: linuxConfig.executablePath, args: [model], shell: false });
  assert.deepEqual(mac, { executable: '/usr/bin/open', args: ['-a', '/Applications/Slicer.app', '--args', model], shell: false });
});

test('requires platform-appropriate explicit application paths', () => {
  assert.throws(() => validateSlicerConfig({ kind: 'application', platform: 'win32', executablePath: 'slicer.bat' }, 'win32'), /executable/);
  assert.throws(() => validateSlicerConfig({ kind: 'application', platform: 'darwin', executablePath: '/Applications/Slicer' }, 'darwin'), /\.app/);
});

test('rejects a changed archive entry identity and unsupported indexed extension', async () => {
  const f = await fixture();
  const service = createSlicerHandoff({ userDataPath: f.root, platform: 'linux', lookupIndexedFile: () => ({ path: `${f.archivePath}::entry::elsewhere.stl`, extension: 'stl' }), launch: async () => { assert.fail('must not launch'); }, validateApplication: async () => null });
  assert.equal((await service.open(f.virtualPath, linuxConfig)).status, 'failure');
  const unsupported = createSlicerHandoff({ userDataPath: f.root, platform: 'linux', lookupIndexedFile: p => ({ path: p, extension: 'zip' }), launch: async () => { assert.fail('must not launch'); }, validateApplication: async () => null });
  assert.deepEqual(await unsupported.open(f.virtualPath, linuxConfig), { status: 'failure', reason: 'unsupported-format', action: 'Choose an indexed STL, OBJ, or 3MF model.' });
  await fs.rm(f.root, { recursive: true, force: true });
});

test('rejects ZIP symlinks and traversal-bearing stored identities before launch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-slicer-'));
  const archivePath = path.join(root, 'links.zip');
  const zip = new JSZip();
  zip.file('../escape.stl', 'bad');
  zip.file('link.stl', 'target', { unixPermissions: '120777' });
  await fs.writeFile(archivePath, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
  let launches = 0;
  const makeService = () => createSlicerHandoff({ userDataPath: root, platform: 'linux', lookupIndexedFile: p => ({ path: p, extension: 'stl' }), launch: async () => { launches += 1; }, validateApplication: async () => null });
  const traversalPath = `${archivePath}::entry::../escape.stl`;
  assert.equal((await makeService().open(traversalPath, linuxConfig)).status, 'failure');
  const symlinkPath = `${archivePath}::entry::link.stl`;
  assert.equal((await makeService().open(symlinkPath, linuxConfig)).status, 'failure');
  assert.equal(launches, 0);
  assert.equal(await fs.stat(archivePath).then(s => s.isFile()), true);
  await fs.rm(root, { recursive: true, force: true });
});

test('bounds streamed bytes even when ZIP size metadata is untrusted', async () => {
  const f = await fixture();
  const service = createSlicerHandoff({ userDataPath: f.root, platform: 'linux', lookupIndexedFile: () => ({ path: f.virtualPath, extension: 'stl' }), launch: async () => { assert.fail('must not launch'); }, validateApplication: async () => null, maxUncompressedBytes: 5 });
  const result = await service.open(f.virtualPath, linuxConfig);
  assert.equal(result.status, 'failure');
  assert.equal((result as { reason?: string }).reason, 'size-limit');
  assert.deepEqual(await fs.readdir(path.join(f.root, 'slicer-handoff')).catch(() => []), []);
  await fs.rm(f.root, { recursive: true, force: true });
});

test('cleans only regular files older than 24 hours in the owned handoff directory', async () => {
  const f = await fixture();
  const handoff = path.join(f.root, 'slicer-handoff');
  await fs.mkdir(handoff);
  const stale = path.join(handoff, 'stale.stl');
  const fresh = path.join(handoff, 'fresh.stl');
  await fs.writeFile(stale, 'old'); await fs.writeFile(fresh, 'new');
  await fs.utimes(stale, new Date(0), new Date(0));
  const outside = path.join(f.root, 'outside.stl'); await fs.writeFile(outside, 'keep');
  const service = createSlicerHandoff({ userDataPath: f.root, platform: 'linux', lookupIndexedFile: () => null, launch: async () => {} });
  await service.cleanupOldFiles();
  assert.deepEqual(await fs.readdir(handoff), ['fresh.stl']);
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
  await fs.rm(f.root, { recursive: true, force: true });
});
