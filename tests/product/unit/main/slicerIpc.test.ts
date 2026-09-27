import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSlicerIpcHandlers, cancelAllSlicerHandoffs } from '../../../../src/main/ipc/slicer';
import type { SlicerHandoffRequest } from '../../../../src/shared/backupContracts';

function setup() {
  const sender = Object.assign(new EventEmitter(), { id: 101, isDestroyed: () => false }) as unknown as Electron.WebContents;
  const window = { isDestroyed: () => false, webContents: sender } as unknown as Electron.BrowserWindow;
  const request: SlicerHandoffRequest = { requestId: 'open-1', fileId: 1, contentRevision: 2, path: '/tmp/model.stl', extension: 'stl', configuration: { applicationPath: '/Applications/Slicer.app', useSystemDefault: false } };
  let options: Electron.OpenDialogOptions | undefined;
  const handlers = createSlicerIpcHandlers({
    platform: 'darwin', getMainWindow: () => window,
    handoff: { open: async (_request, signal) => new Promise(resolve => signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true })) },
    dialog: { showOpenDialog: async (_window, value) => { options = value; return { canceled: false, filePaths: ['/Applications/Slicer.app'] }; } },
  });
  return { sender, window, request, handlers, getOptions: () => options };
}

test('only current main renderer can pick a macOS application package as a file', async () => {
  const f = setup();
  const result = await f.handlers.pick({ sender: f.sender } as Electron.IpcMainInvokeEvent);
  assert.deepEqual(result, { applicationPath: '/Applications/Slicer.app', useSystemDefault: false });
  assert.deepEqual(f.getOptions()?.properties, ['openFile']);
});

test('Windows native picker restricts selection to executable files', async () => {
  const sender = Object.assign(new EventEmitter(), { id: 303, isDestroyed: () => false }) as unknown as Electron.WebContents;
  const window = { isDestroyed: () => false, webContents: sender } as unknown as Electron.BrowserWindow;
  let options: Electron.OpenDialogOptions | undefined;
  const handlers = createSlicerIpcHandlers({ platform: 'win32', getMainWindow: () => window,
    handoff: { open: async () => ({ status: 'cancelled' }) },
    dialog: { showOpenDialog: async (_window, value) => { options = value; return { canceled: true, filePaths: [] }; } },
  });
  assert.equal(await handlers.pick({ sender } as Electron.IpcMainInvokeEvent), null);
  assert.deepEqual(options?.filters, [{ name: 'Applications', extensions: ['exe'] }]);
  assert.deepEqual(options?.properties, ['openFile']);
});

test('rejects IPC from another renderer and does not let it cancel the main window request', async () => {
  const f = setup();
  const other = Object.assign(new EventEmitter(), { id: 202, isDestroyed: () => false }) as unknown as Electron.WebContents;
  const pending = f.handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, f.request);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => f.handlers.open({ sender: other } as Electron.IpcMainInvokeEvent, f.request), /main Polytray window/);
  await assert.rejects(() => f.handlers.pick({ sender: other } as Electron.IpcMainInvokeEvent), /main Polytray window/);
  await assert.rejects(() => f.handlers.pick({ sender: f.sender, senderFrame: {} } as Electron.IpcMainInvokeEvent), /main Polytray window/);
  assert.equal(f.handlers.cancel({ sender: f.sender } as Electron.IpcMainInvokeEvent, 'other-request'), false);
  assert.throws(() => f.handlers.cancel({ sender: other } as Electron.IpcMainInvokeEvent, f.request.requestId), /main Polytray window/);
  assert.equal(f.handlers.cancel({ sender: f.sender } as Electron.IpcMainInvokeEvent, f.request.requestId), true);
  assert.deepEqual(await pending, { status: 'cancelled' });
  cancelAllSlicerHandoffs();
});

test('cancels active extraction when its requesting webContents is destroyed', async () => {
  const f = setup();
  const pending = f.handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, f.request);
  await new Promise(resolve => setImmediate(resolve));
  (f.sender as unknown as EventEmitter).emit('destroyed');
  assert.deepEqual(await pending, { status: 'cancelled' });
});

test('cancels every outstanding extraction during app shutdown', async () => {
  const f = setup();
  const pending = f.handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, f.request);
  await new Promise(resolve => setImmediate(resolve));
  cancelAllSlicerHandoffs();
  assert.deepEqual(await pending, { status: 'cancelled' });
});

test('removes lifecycle listeners after each request instead of accumulating destroyed listeners', async () => {
  const f = setup();
  const requests = f.sender as unknown as EventEmitter;
  const baseline = ['destroyed', 'did-start-navigation', 'render-process-gone'].map(name => requests.listenerCount(name));
  const handlers = createSlicerIpcHandlers({ platform: 'darwin', getMainWindow: () => f.window,
    handoff: { open: async () => ({ status: 'launched', handoffPath: '/tmp/model.stl' }) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  });
  for (let index = 0; index < 15; index += 1) {
    await handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, { ...f.request, requestId: `seq-${index}` });
    assert.deepEqual(['destroyed', 'did-start-navigation', 'render-process-gone'].map(name => requests.listenerCount(name)), baseline);
  }
});

test('cancels on main-frame navigation and process loss, but not in-page navigation', async () => {
  const f = setup();
  let lastSignal: AbortSignal | undefined;
  const handlers = createSlicerIpcHandlers({ platform: 'darwin', getMainWindow: () => f.window,
    handoff: { open: async (_request, signal) => new Promise(resolve => { lastSignal = signal; signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true }); }) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  });
  const hashNavigation = handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, f.request);
  await new Promise(resolve => setImmediate(resolve));
  (f.sender as unknown as EventEmitter).emit('did-start-navigation', {}, 'file:///app/#settings', true, true);
  assert.equal(lastSignal?.aborted, false);
  (f.sender as unknown as EventEmitter).emit('did-start-navigation', {}, 'file:///app/other', false, true);
  assert.deepEqual(await hashNavigation, { status: 'cancelled' });

  const processLoss = handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, { ...f.request, requestId: 'process-loss' });
  await new Promise(resolve => setImmediate(resolve));
  (f.sender as unknown as EventEmitter).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.deepEqual(await processLoss, { status: 'cancelled' });
});

test('destroyed cleanup uses the captured sender ID and removes all listeners', async () => {
  const f = setup();
  const sender = f.sender as unknown as EventEmitter & { id: number };
  let destroyed = false;
  Object.defineProperty(sender, 'id', { configurable: true, get: () => { if (destroyed) throw new Error('sender id read after destruction'); return 707; } });
  const before = ['destroyed', 'did-start-navigation', 'render-process-gone'].map(name => sender.listenerCount(name));
  const pending = f.handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, f.request);
  await new Promise(resolve => setImmediate(resolve));
  destroyed = true;
  sender.emit('destroyed');
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.deepEqual(['destroyed', 'did-start-navigation', 'render-process-gone'].map(name => sender.listenerCount(name)), before);
});

test('validates bounded request identifiers and absolute app paths at the IPC boundary', async () => {
  const f = setup();
  await assert.rejects(() => f.handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, { ...f.request, requestId: 'bad id' }), /request ID/);
  await assert.rejects(() => f.handlers.open({ sender: f.sender } as Electron.IpcMainInvokeEvent, { ...f.request, configuration: { applicationPath: 'slicer', useSystemDefault: false } }), /absolute/);
});
