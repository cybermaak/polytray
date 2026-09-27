import test from 'node:test';
import assert from 'node:assert/strict';
import type { PreviewParseRequest, PreparedPreview, PreviewParsePortMessage } from '../../../../src/shared/previewContracts';
import type { MessagePortMain, WebContents } from 'electron';
import { createPreviewParseService, trackPreviewRequesterLifecycle } from '../../../../src/main/previewParseService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function request(requestId: string, filePath: string): PreviewParseRequest {
  return { requestId, path: filePath, extension: '3mf', contentRevision: 1 };
}

function prepared(name: string): PreparedPreview {
  const max = name === 'C' ? 3 : 1;
  return {
    meshes: [],
    orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    bounds: { min: [0, 0, 0], max: [max, max, max] },
    measurements: { version: 1, x: 1, y: 1, z: 1, unit: 'mm', basis: 'source-build', status: 'available' },
  };
}

function makeReply() {
  const messages: PreviewParsePortMessage[] = [];
  const closed = { value: false };
  const done = deferred<PreviewParsePortMessage>();
  return {
    messages,
    closed,
    done: done.promise,
    transferPort: undefined as (() => MessagePortMain) | undefined,
    postMessage(message: PreviewParsePortMessage) {
      messages.push(message);
      if (messages.length === 1) done.resolve(message);
    },
    close() { closed.value = true; },
  };
}

class FakeRequesterEvents {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private alive = true;
  constructor(private readonly requesterId: number) {}
  get id() {
    if (!this.alive) throw new Error('destroyed requester ID getter was accessed');
    return this.requesterId;
  }
  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  once(event: string, listener: (...args: unknown[]) => void) {
    const onceListener = (...args: unknown[]) => {
      this.removeListener(event, onceListener);
      listener(...args);
    };
    Object.defineProperty(onceListener, 'listener', { value: listener });
    return this.on(event, onceListener);
  }
  removeListener(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event);
    for (const registered of listeners ?? []) {
      if (registered === listener || (registered as unknown as { listener?: unknown }).listener === listener) {
        listeners?.delete(registered);
      }
    }
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
  markDestroyed() { this.alive = false; }
  listenerCount(event: string) { return this.listeners.get(event)?.size ?? 0; }
}

test('rapid A to B to C replacement stops A and publishes only C', async () => {
  const parsePromises = new Map<string, ReturnType<typeof deferred<PreparedPreview>>>();
  const started = new Map<string, ReturnType<typeof deferred<void>>>();
  const terminate = deferred<void>();
  let runtimeRestarts = 0;
  const service = createPreviewParseService({
    ensureRuntime: async () => {},
    runParse: (job) => {
      const wait = deferred<PreparedPreview>();
      parsePromises.set(job.path, wait);
      started.get(job.path)?.resolve();
      return wait.promise;
    },
    restartRuntime: async () => { runtimeRestarts += 1; terminate.resolve(); },
    timeoutMs: 10_000,
  });
  const replyA = makeReply();
  const replyB = makeReply();
  const replyC = makeReply();
  for (const model of ['A', 'B', 'C']) started.set(model, deferred<void>());

  service.request(7, request('request-A', 'A'), replyA);
  await started.get('A')!.promise;
  service.request(7, request('request-B', 'B'), replyB);
  service.request(7, request('request-C', 'C'), replyC);

  assert.equal((await replyA.done).type, 'cancelled');
  assert.equal((await replyB.done).type, 'cancelled');
  await terminate.promise;
  await started.get('C')!.promise;
  parsePromises.get('C')!.resolve(prepared('C'));
  const resultC = await replyC.done;
  assert.equal(resultC.type, 'done');
  if (resultC.type === 'done') assert.equal(resultC.preview.bounds.max[0], 3);
  parsePromises.get('A')!.resolve(prepared('A late'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replyA.messages.length, 1);
  assert.equal(replyB.messages.length, 1);
  assert.equal(replyC.messages.length, 1);
  assert.equal(runtimeRestarts, 1);
  assert.deepEqual([...parsePromises.keys()], ['A', 'C']);
  await service.dispose();
});

test('requester close cancels its active and queued parses', async () => {
  const activeParse = deferred<PreparedPreview>();
  const started = deferred<void>();
  let restarted = 0;
  const service = createPreviewParseService({
    ensureRuntime: async () => {},
    runParse: (job) => { started.resolve(); return activeParse.promise; },
    restartRuntime: async () => { restarted += 1; },
    timeoutMs: 10_000,
  });
  const activeReply = makeReply();
  const queuedReply = makeReply();
  service.request(18, request('active', 'A'), activeReply);
  await started.promise;
  service.request(18, request('queued', 'B'), queuedReply);

  await service.cancelRequester(18);
  assert.equal((await activeReply.done).type, 'cancelled');
  assert.equal((await queuedReply.done).type, 'cancelled');
  assert.equal(activeReply.closed.value, true);
  assert.equal(queuedReply.closed.value, true);
  assert.equal(restarted, 1);
  activeParse.resolve(prepared('late A'));
  await service.dispose();
});

test('cancel before preview runtime readiness never dispatches parsing', async () => {
  const ready = deferred<void>();
  const runtimeWaiting = deferred<void>();
  let parseCount = 0;
  let restartCount = 0;
  const service = createPreviewParseService({
    ensureRuntime: () => { runtimeWaiting.resolve(); return ready.promise; },
    runParse: async () => { parseCount += 1; return prepared('unexpected'); },
    restartRuntime: async () => { restartCount += 1; },
    timeoutMs: 10_000,
  });
  const reply = makeReply();
  service.request(30, request('before-ready', 'A'), reply);
  await runtimeWaiting.promise;
  await service.cancel(30, { requestId: 'before-ready', reason: 'user' });
  assert.equal((await reply.done).type, 'cancelled');
  ready.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(parseCount, 0);
  assert.equal(restartCount, 1);
  await service.dispose();
});

test('cancel arriving before the request leaves a bounded cancellation tombstone', async () => {
  let parseCount = 0;
  const service = createPreviewParseService({
    ensureRuntime: async () => {},
    runParse: async () => { parseCount += 1; return prepared('unexpected'); },
    restartRuntime: async () => {},
    timeoutMs: 10_000,
  });
  await service.cancel(44, { requestId: 'cancel-first', reason: 'user' });
  const reply = makeReply();
  service.request(44, request('cancel-first', 'A'), reply);
  assert.equal((await reply.done).type, 'cancelled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(parseCount, 0);
  assert.equal(reply.closed.value, true);
  await service.dispose();
});

test('another webContents cannot cancel an owned preview request with the same ID', async () => {
  const activeParse = deferred<PreparedPreview>();
  const started = deferred<void>();
  let restarts = 0;
  const service = createPreviewParseService({
    ensureRuntime: async () => {},
    runParse: () => { started.resolve(); return activeParse.promise; },
    restartRuntime: async () => { restarts += 1; },
    timeoutMs: 10_000,
  });
  const reply = makeReply();
  service.request(1, request('same-id', 'A'), reply);
  await started.promise;
  await service.cancel(2, { requestId: 'same-id', reason: 'user' });
  assert.equal(reply.messages.length, 0);
  assert.equal(restarts, 0);
  activeParse.resolve(prepared('A'));
  assert.equal((await reply.done).type, 'done');
  await service.dispose();
});

test('main archive source reads are owned by the renderer request ID and abortable', async () => {
  const readStarted = deferred<void>();
  const finishLateRead = deferred<ArrayBuffer>();
  let readSignal: AbortSignal | null = null;
  const service = createPreviewParseService({
    ensureRuntime: async () => {},
    runParse: async () => prepared('unused'),
    restartRuntime: async () => {},
    readArchiveEntryBuffer: (_request, signal) => {
      readSignal = signal;
      readStarted.resolve();
      return finishLateRead.promise;
    },
  });
  const reading = service.readPreviewArchiveBufferForRenderer(71, request('archive-read', '/library/model.zip::entry::part.3mf'));
  await readStarted.promise;
  await service.cancel(71, { requestId: 'archive-read', reason: 'replaced' });
  await assert.rejects(reading, (error: Error) => error.name === 'AbortError');
  assert.equal(readSignal?.aborted, true);
  finishLateRead.resolve(new ArrayBuffer(8));
  await service.dispose();
});

test('independent thumbnail work completes while preview runtime is cancelled', async () => {
  const activeParse = deferred<PreparedPreview>();
  const started = deferred<void>();
  const thumbnail = deferred<string>();
  const service = createPreviewParseService({
    ensureRuntime: async () => {},
    runParse: () => { started.resolve(); return activeParse.promise; },
    restartRuntime: async () => {},
    timeoutMs: 10_000,
  });
  const reply = makeReply();
  service.request(55, request('preview', 'A'), reply);
  await started.promise;
  const thumbnailResult = thumbnail.promise;
  service.cancel(55, { requestId: 'preview', reason: 'disposed' });
  thumbnail.resolve('thumbnail-finished');
  assert.equal(await thumbnailResult, 'thumbnail-finished');
  assert.equal((await reply.done).type, 'cancelled');
  activeParse.resolve(prepared('obsolete'));
  assert.equal(reply.messages.length, 1);
  await service.dispose();
});

test('direct renderer result settles the main job without posting geometry through main', async () => {
  const responsePort = {} as MessagePortMain;
  const started = deferred<void>();
  const rendererAck = deferred<void>();
  let receivedPort: MessagePortMain | undefined;
  const service = createPreviewParseService({
    ensureRuntime: async () => {},
    runParse: async (_request, _archiveBuffer, port) => {
      receivedPort = port;
      started.resolve();
      await rendererAck.promise;
      return undefined;
    },
    restartRuntime: async () => {},
    timeoutMs: 10_000,
  });
  const reply = makeReply();
  reply.transferPort = () => responsePort;
  service.request(82, request('direct-result', 'A'), reply);
  await started.promise;
  assert.equal(receivedPort, responsePort);
  rendererAck.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reply.messages, []);
  assert.equal(reply.closed.value, true);
  await service.dispose();
});

test('requester lifecycle captures ID before destruction and cleans listeners and tracking exactly once', () => {
  const requester = new FakeRequesterEvents(93);
  const tracked = new Map<number, () => void>();
  const cancelled: number[] = [];
  trackPreviewRequesterLifecycle(requester as unknown as WebContents, tracked, (requesterId) => cancelled.push(requesterId));
  trackPreviewRequesterLifecycle(requester as unknown as WebContents, tracked, (requesterId) => cancelled.push(requesterId));
  assert.equal(tracked.size, 1);
  assert.equal(requester.listenerCount('destroyed'), 1);
  assert.equal(requester.listenerCount('render-process-gone'), 1);
  assert.equal(requester.listenerCount('did-start-navigation'), 1);

  requester.emit('did-start-navigation', {}, 'file:///index.html#section', true, true);
  assert.deepEqual(cancelled, []);
  assert.equal(tracked.size, 1);

  requester.markDestroyed();
  requester.emit('destroyed');
  requester.emit('render-process-gone');
  assert.deepEqual(cancelled, [93]);
  assert.equal(tracked.size, 0);
  assert.equal(requester.listenerCount('destroyed'), 0);
  assert.equal(requester.listenerCount('render-process-gone'), 0);
  assert.equal(requester.listenerCount('did-start-navigation'), 0);
});

test('only a non-in-place main-frame navigation cancels requester-owned work', () => {
  const requester = new FakeRequesterEvents(94);
  const tracked = new Map<number, () => void>();
  const cancelled: number[] = [];
  trackPreviewRequesterLifecycle(requester as unknown as WebContents, tracked, (requesterId) => cancelled.push(requesterId));
  requester.emit('did-start-navigation', {}, 'file:///index.html#section', true, true);
  requester.emit('did-start-navigation', {}, 'file:///child-frame.html', false, false);
  assert.deepEqual(cancelled, []);
  assert.equal(tracked.size, 1);

  requester.emit('did-start-navigation', {}, 'file:///replacement.html', false, true);
  assert.deepEqual(cancelled, [94]);
  assert.equal(tracked.size, 0);
  assert.equal(requester.listenerCount('destroyed'), 0);
  assert.equal(requester.listenerCount('render-process-gone'), 0);
  assert.equal(requester.listenerCount('did-start-navigation'), 0);
});
