import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewWindowManager } from '../../../../src/main/previewWindow';

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
    dispatch: async (window, request) => ({
      meshes: [], orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    }),
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
