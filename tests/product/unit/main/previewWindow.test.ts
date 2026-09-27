import test from 'node:test';
import assert from 'node:assert/strict';
import { canForceCrashPreviewRenderer, createPreviewWindowManager } from '../../../../src/main/previewWindow';

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
  assert.equal(canForceCrashPreviewRenderer(30, [10, 20]), true);
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
