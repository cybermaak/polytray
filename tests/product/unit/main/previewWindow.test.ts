import test from 'node:test';
import assert from 'node:assert/strict';
import { canForceCrashPreviewRenderer, createPreviewWindowManager } from '../../../../src/main/previewWindow';
import * as previewWindowPolicy from '../../../../src/main/previewWindow';

interface FakeWindow { senderId: number; destroyed: boolean; }

test('preview window is lazy, accepts readiness only from its owner, and restarts only itself', async () => {
  const windows: FakeWindow[] = [];
  const destroyed: FakeWindow[] = [];
  const manager = createPreviewWindowManager<FakeWindow>({
    create: () => {
      const window = { senderId: windows.length + 10, destroyed: false };
      windows.push(window);
      return window;
    },
    load: async () => {},
    destroy: async (window) => { window.destroyed = true; destroyed.push(window); },
    senderId: (window) => window.senderId,
    isDestroyed: (window) => window.destroyed,
    dispatch: async () => {},
    readinessTimeoutMs: 100,
  });

  assert.equal(windows.length, 0);
  const firstReady = manager.ensureReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(windows.length, 1);
  assert.equal(manager.markReady(999), false);
  assert.equal(manager.markReady(windows[0].senderId), true);
  assert.equal(await firstReady, windows[0]);
  await manager.restart();
  assert.deepEqual(destroyed, [windows[0]]);
  assert.equal(manager.getCurrentWindow(), null);
  const secondReady = manager.ensureReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(windows.length, 2);
  assert.equal(manager.markReady(windows[1].senderId), true);
  assert.equal(await secondReady, windows[1]);
  await manager.close();
});

test('preview runtime readiness failure is bounded and permits a later restart', async () => {
  const windows: FakeWindow[] = [];
  const manager = createPreviewWindowManager<FakeWindow>({
    create: () => {
      const window = { senderId: windows.length + 20, destroyed: false };
      windows.push(window);
      return window;
    },
    load: async (_window, attempt) => {
      if (attempt === 1) throw new Error('load failed');
    },
    destroy: async (window) => { window.destroyed = true; },
    senderId: (window) => window.senderId,
    isDestroyed: (window) => window.destroyed,
    dispatch: async () => { throw new Error('not reached'); },
    readinessTimeoutMs: 10,
  });
  await assert.rejects(manager.ensureReady(), /load failed/);
  assert.equal(manager.getCurrentWindow(), null);
  const next = manager.ensureReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.markReady(windows[1].senderId), true);
  assert.equal(await next, windows[1]);
  await manager.close();
});

test('force-crash guard refuses unknown, invalid, and shared renderer process IDs', () => {
  assert.equal(canForceCrashPreviewRenderer(0, [10, 20]), false);
  assert.equal(canForceCrashPreviewRenderer(-1, [10, 20]), false);
  assert.equal(canForceCrashPreviewRenderer(Number.NaN, [10, 20]), false);
  assert.equal(canForceCrashPreviewRenderer(10, [10, 20]), false);
  assert.equal(canForceCrashPreviewRenderer(process.pid, [10, 20]), false);
  assert.equal(canForceCrashPreviewRenderer(process.pid, [10, 20], 0), false);
  assert.equal(canForceCrashPreviewRenderer(30, [10, 20]), true);
});

test('Linux never force-crashes when the owned process claim is missing or rejected', () => {
  const fallback = (previewWindowPolicy as any).shouldUseElectronCrashFallback;
  assert.equal(typeof fallback, 'function');
  assert.equal(fallback('linux', true, false), false);
  assert.equal(fallback('linux', true, true), false);
  assert.equal(fallback('linux', false, false), false);
  assert.equal(fallback('darwin', true, false), true);
  assert.equal(fallback('win32', true, false), true);
  assert.equal(fallback('darwin', true, true), false);
});

test('Linux accepts parse work only after a verified termination claim exists', () => {
  const accept = (previewWindowPolicy as any).canAcceptPreviewRenderer;
  assert.equal(typeof accept, 'function');
  assert.equal(accept('linux', true, false), false);
  assert.equal(accept('linux', true, true), true);
  assert.equal(accept('linux', false, true), false);
  assert.equal(accept('darwin', true, false), true);
  assert.equal(accept('win32', true, false), true);
});

test('owned Linux preview process claims require one live renderer owner and exact process identity', () => {
  const capture = (previewWindowPolicy as any).captureOwnedPreviewProcess;
  assert.equal(typeof capture, 'function');
  const valid = {
    generation: 7, senderId: 3, pid: 30, selfPid: 1,
    protectedPids: [10, 20], windowAlive: true,
    owners: [{ senderId: 1, pid: 10 }, { senderId: 2, pid: 20 }, { senderId: 3, pid: 30 }],
    metricType: 'Tab', startTicks: '12345',
    argv: ['/app/electron', '--type=renderer', '--user-data-dir=/tmp/owned'],
    commandLineFingerprint: 'abcd',
    executablePath: '/app/electron', userDataDir: '/tmp/owned',
  };
  assert.ok(capture(valid));
  for (const candidate of [
    { pid: 0 }, { pid: -1 }, { pid: 1.5 }, { pid: 1 }, { pid: 10 }, { pid: 20 },
    { selfPid: 0 }, { selfPid: Number.NaN },
    { selfPid: 0, pid: process.pid, owners: [{ senderId: 3, pid: process.pid }] },
    { generation: 0 }, { windowAlive: false }, { metricType: 'Utility' },
    { protectedPids: undefined }, { owners: undefined }, { argv: undefined },
    { owners: [] }, { argv: [] },
    { owners: [{ senderId: 3, pid: 30 }, { senderId: 4, pid: 30 }] },
    { owners: [{ senderId: 4, pid: 30 }] },
    { startTicks: null }, { startTicks: 'not-a-number' },
    { commandLineFingerprint: null },
    { argv: ['/app/electron', '--type=utility', '--user-data-dir=/tmp/owned'] },
    { argv: ['/app/electron', '--type=renderer', '--user-data-dir=/tmp/other'] },
    { argv: ['/other/electron', '--type=renderer', '--user-data-dir=/tmp/owned'] },
    { argv: ['/app/electron', '--type=renderer', '--type=utility', '--user-data-dir=/tmp/owned'] },
  ]) {
    assert.equal(capture({ ...valid, ...candidate }), null, JSON.stringify(candidate));
  }
});

test('owned preview termination rejects changed or missing live authority and signals only once', () => {
  const capture = (previewWindowPolicy as any).captureOwnedPreviewProcess;
  const signal = (previewWindowPolicy as any).signalOwnedPreviewProcess;
  assert.equal(typeof capture, 'function');
  assert.equal(typeof signal, 'function');
  const valid = {
    generation: 7, senderId: 3, pid: 30, selfPid: 1,
    protectedPids: [10, 20], windowAlive: true,
    owners: [{ senderId: 1, pid: 10 }, { senderId: 2, pid: 20 }, { senderId: 3, pid: 30 }],
    metricType: 'Tab', startTicks: '12345',
    argv: ['/app/electron', '--type=renderer', '--user-data-dir=/tmp/owned'],
    commandLineFingerprint: 'abcd',
    executablePath: '/app/electron', userDataDir: '/tmp/owned',
  };
  for (const change of [
    { generation: 8 }, { senderId: 4 }, { pid: 31 }, { startTicks: '12346' },
    { commandLineFingerprint: 'abce' },
    { windowAlive: false }, { metricType: null },
    { owners: [{ senderId: 3, pid: 30 }, { senderId: 4, pid: 30 }] },
    { argv: ['/app/electron', '--type=renderer', '--user-data-dir=/tmp/other'] },
  ]) {
    const claim = capture(valid);
    let calls = 0;
    assert.equal(signal(claim, () => ({ ...valid, ...change }), () => { calls++; }), false, JSON.stringify(change));
    assert.equal(calls, 0);
  }
  const exited = capture(valid);
  let calls = 0;
  assert.equal(signal(exited, () => null, () => { calls++; }), false);
  assert.equal(calls, 0);
  const owned = capture(valid);
  assert.equal(signal(owned, () => valid, (pid: number) => { assert.equal(pid, 30); calls++; }), true);
  assert.equal(signal(owned, () => valid, () => { calls++; }), false);
  assert.equal(calls, 1);
});

test('Linux proc identity parsing rejects missing or malformed process evidence', () => {
  const parse = (previewWindowPolicy as any).parseLinuxPreviewProcessIdentity;
  assert.equal(typeof parse, 'function');
  const tail = ['S', ...Array(18).fill('0'), '12345'];
  const stat = `30 (electron renderer) ${tail.join(' ')}`;
  const argv = Buffer.from('/app/electron\0--type=renderer\0--user-data-dir=/tmp/owned\0');
  assert.deepEqual(parse(stat, argv), {
    pid: 30,
    startTicks: '12345',
    argv: ['/app/electron', '--type=renderer', '--user-data-dir=/tmp/owned'],
    commandLineFingerprint: argv.toString('hex'),
  });
  const flattened = Buffer.from('/app/electron --type=renderer --user-data-dir=/tmp/owned --app-path=/app/main\0');
  assert.deepEqual(parse(stat, flattened), {
    pid: 30,
    startTicks: '12345',
    argv: ['/app/electron', '--type=renderer', '--user-data-dir=/tmp/owned', '--app-path=/app/main'],
    commandLineFingerprint: flattened.toString('hex'),
  });
  assert.equal(parse('30 (electron) S 0 0', argv), null);
  assert.equal(parse(stat.replace('12345', 'invalid'), argv), null);
  assert.equal(parse(stat, Buffer.alloc(0)), null);
  assert.equal(parse(stat, Buffer.from('/app/electron')), null);
});

test('Linux proc reads fail closed on permission errors and PID mismatch', () => {
  const read = (previewWindowPolicy as any).readLinuxPreviewProcessIdentity;
  assert.equal(typeof read, 'function');
  const tail = ['S', ...Array(18).fill('0'), '12345'];
  const stat = Buffer.from(`30 (electron renderer) ${tail.join(' ')}`);
  const argv = Buffer.from('/app/electron\0--type=renderer\0--user-data-dir=/tmp/owned\0');
  const readFile = (target: string) => target.endsWith('/stat') ? stat : argv;
  assert.deepEqual(read(30, readFile), {
    pid: 30, startTicks: '12345',
    argv: ['/app/electron', '--type=renderer', '--user-data-dir=/tmp/owned'],
    commandLineFingerprint: argv.toString('hex'),
  });
  assert.equal(read(31, readFile), null);
  assert.equal(read(30, () => { throw new Error('EACCES'); }), null);
  assert.equal(read(30, () => Buffer.alloc(0)), null);
});

test('runtime with shared PID never becomes ready and is safely discarded', async () => {
  const window = { senderId: 41, destroyed: false };
  let destroyCount = 0;
  const manager = createPreviewWindowManager<FakeWindow>({
    create: () => window,
    load: async () => {},
    destroy: async (owned) => { owned.destroyed = true; destroyCount++; },
    senderId: (owned) => owned.senderId,
    isDestroyed: (owned) => owned.destroyed,
    canForceCrash: () => false,
    dispatch: async () => { throw new Error('not reached'); },
    readinessTimeoutMs: 100,
  });
  const ready = manager.ensureReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.markReady(window.senderId), false);
  await assert.rejects(ready, /isolated, valid OS process/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destroyCount, 1);
  assert.equal(manager.getCurrentWindow(), null);
  await manager.close();
});
