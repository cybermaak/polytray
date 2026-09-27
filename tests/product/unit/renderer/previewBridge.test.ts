import test from 'node:test';
import assert from 'node:assert/strict';
import type { IpcRenderer } from 'electron';
import { createPreviewBridge } from '../../../../src/preload/previewBridge';
import { IPC } from '../../../../src/shared/types';
import type { PreparedPreview } from '../../../../src/shared/previewContracts';

class FakeIpcRenderer {
  listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  invokes: Array<{ channel: string; payload: unknown }> = [];
  sends: Array<{ channel: string; payload: unknown }> = [];
  on(channel: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(channel, [...(this.listeners.get(channel) ?? []), listener]);
    return this;
  }
  invoke(channel: string, payload: unknown) {
    this.invokes.push({ channel, payload });
    return Promise.resolve(true);
  }
  send(channel: string, payload: unknown) {
    this.sends.push({ channel, payload });
  }
  emit(channel: string, data: unknown, ports: unknown[] = []) {
    for (const listener of this.listeners.get(channel) ?? []) listener({ ports }, data);
  }
}

function makePort() {
  return {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onmessageerror: null as (() => void) | null,
    closed: false,
    started: false,
    start() { this.started = true; },
    close() { this.closed = true; },
  };
}

const preview: PreparedPreview = {
  meshes: [],
  orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
};

test('renderer registers request before IPC dispatch and resolves the returned preview port', async () => {
  const ipc = new FakeIpcRenderer();
  const bridge = createPreviewBridge(ipc as unknown as IpcRenderer, { addEventListener() {} });
  const request = { requestId: 'request-1', path: '/models/model.3mf', extension: '3mf', contentRevision: 4 };
  const result = bridge.requestPreviewParse(request);
  assert.equal(ipc.invokes.length, 1);
  assert.equal((ipc.invokes[0].payload as typeof request).requestId, request.requestId);

  const port = makePort();
  ipc.emit(IPC.PREVIEW_PARSE_PORT, { requestId: request.requestId }, [port]);
  assert.equal(port.started, true);
  port.onmessage?.({ data: { requestId: request.requestId, type: 'done', preview } });
  assert.deepEqual(await result, preview);
  assert.equal(port.closed, true);
});

test('cancel before response port delivery settles once and closes a late port', async () => {
  const ipc = new FakeIpcRenderer();
  const bridge = createPreviewBridge(ipc as unknown as IpcRenderer, { addEventListener() {} });
  const request = { requestId: 'late-port', path: '/models/model.3mf', extension: '3mf', contentRevision: 2 };
  const result = bridge.requestPreviewParse(request);
  bridge.cancelPreviewParse(request.requestId, 'replaced');
  await assert.rejects(result, (error: Error) => error.name === 'AbortError');
  assert.deepEqual(ipc.sends[0], {
    channel: IPC.CANCEL_PREVIEW_PARSE,
    payload: { requestId: request.requestId, reason: 'replaced' },
  });
  const latePort = makePort();
  ipc.emit(IPC.PREVIEW_PARSE_PORT, { requestId: request.requestId }, [latePort]);
  assert.equal(latePort.closed, true);
});
