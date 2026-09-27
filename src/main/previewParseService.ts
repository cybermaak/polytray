import { MessageChannelMain, type BrowserWindow, type IpcMain, type MessagePortMain, type WebContents } from 'electron';
import type { Readable } from 'stream';
import * as unzipper from 'unzipper';
import type { Database } from 'better-sqlite3';
import { IPC, type PreviewParseControlData, type PreviewParsePortData } from '../shared/types';
import type {
  PreparedPreview,
  PreviewParseCancelRequest,
  PreviewParsePortMessage,
  PreviewParseRequest,
} from '../shared/previewContracts';
import { parseArchiveEntryPath } from '../shared/archivePaths';
import { isPathContained } from './pathContainment';
import { getDb } from './database';
import {
  parsePreviewParseCancelRequest,
  parsePreviewParseRequest,
  parsePreviewParseSettlementRequest,
} from './ipc/runtimeValidation';
import type { PreviewWindowRuntime } from './previewWindow';

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const CANCELLATION_TOMBSTONE_MS = 5_000;
const MAX_CANCELLATION_TOMBSTONES = 256;

export interface PreviewParseReplyPort {
  postMessage(message: PreviewParsePortMessage, transferables?: ArrayBuffer[]): void;
  close(): void;
  transferPort?(): MessagePortMain;
  onClose?(listener: () => void): () => void;
}

export interface PreviewParseServiceDependencies {
  ensureRuntime(): Promise<void>;
  runParse(request: PreviewParseRequest, archiveBuffer?: ArrayBuffer, responsePort?: MessagePortMain): Promise<PreparedPreview | void>;
  restartRuntime(): Promise<void>;
  readArchiveEntryBuffer?(request: PreviewParseRequest, signal: AbortSignal): Promise<ArrayBuffer>;
  validateIndexedRequest?(request: PreviewParseRequest): void;
  timeoutMs?: number;
  tombstoneMs?: number;
  maxTombstones?: number;
}

interface PreviewParseJob {
  ownerId: number;
  request: PreviewParseRequest;
  reply: PreviewParseReplyPort;
  abortController: AbortController;
  aborted: Promise<void>;
  signalAbort: () => void;
  timer: ReturnType<typeof setTimeout>;
  removeCloseListener: (() => void) | null;
  settled: boolean;
  stopRuntime: Promise<void> | null;
}

interface CancellationTombstone {
  reason: PreviewParseCancelRequest['reason'];
  timer: ReturnType<typeof setTimeout>;
}

interface ArchiveReadJob {
  ownerId: number;
  request: PreviewParseRequest;
  controller: AbortController;
  aborted: Promise<void>;
  signalAbort: () => void;
}

function requestKey(ownerId: number, requestId: string) {
  return `${ownerId}\u0000${requestId}`;
}

function collectTransferables(preview: PreparedPreview): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of preview.meshes) {
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      if (attribute.array.buffer instanceof ArrayBuffer) buffers.add(attribute.array.buffer);
    }
    if (mesh.geometry.index?.array.buffer instanceof ArrayBuffer) {
      buffers.add(mesh.geometry.index.array.buffer);
    }
  }
  return [...buffers];
}

interface IndexedPreviewIdentity {
  extension: string;
  content_revision: number;
  archive_path: string | null;
}

export interface PreviewArchiveEntryStream {
  path: string;
  type: string;
  stream(): Readable;
}

export type PreviewArchiveOpener = (archivePath: string) => Promise<{ files: PreviewArchiveEntryStream[] }>;

const openPreviewArchive = unzipper.Open.file as unknown as PreviewArchiveOpener;

export function validateIndexedPreviewRequest(db: Database, request: PreviewParseRequest): IndexedPreviewIdentity {
  const record = db.prepare(`
    SELECT extension, content_revision, archive_path FROM files WHERE path = ?
  `).get(request.path) as IndexedPreviewIdentity | undefined;
  if (!record) throw new Error('Preview source is not indexed');
  if (record.extension.toLowerCase() !== request.extension.toLowerCase()) {
    throw new Error('Preview extension does not match the indexed file');
  }
  if (record.content_revision !== request.contentRevision) {
    throw new Error('Preview source content revision is stale');
  }

  const archiveEntry = parseArchiveEntryPath(request.path);
  if (archiveEntry) {
    if (!record.archive_path ||
      !isPathContained(record.archive_path, archiveEntry.archivePath) ||
      !isPathContained(archiveEntry.archivePath, record.archive_path)) {
      throw new Error('Preview archive path does not match the indexed identity');
    }
  } else if (record.archive_path !== null) {
    throw new Error('Indexed archive entry path is malformed');
  }
  return record;
}

export async function readIndexedPreviewArchiveBuffer(
  db: Database,
  request: PreviewParseRequest,
  signal: AbortSignal,
  openArchive: PreviewArchiveOpener = openPreviewArchive,
): Promise<ArrayBuffer> {
  if (signal.aborted) throw new DOMException('Preview archive read aborted', 'AbortError');
  const record = validateIndexedPreviewRequest(db, request);
  const archiveEntry = parseArchiveEntryPath(request.path);
  if (!archiveEntry || !record.archive_path) throw new Error('Preview source is not an archive entry');
  const directory = await openArchive(record.archive_path);
  if (signal.aborted) throw new DOMException('Preview archive read aborted', 'AbortError');
  const entry = directory.files.find((candidate) => candidate.path === archiveEntry.entryPath && candidate.type === 'File');
  if (!entry) throw new Error('Indexed preview archive member is missing');

  const stream = entry.stream();
  const chunks: Buffer[] = [];
  const onAbort = () => stream.destroy(new DOMException('Preview archive read aborted', 'AbortError'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const chunk of stream) {
      if (signal.aborted) throw new DOMException('Preview archive read aborted', 'AbortError');
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (signal.aborted) throw new DOMException('Preview archive read aborted', 'AbortError');
    const buffer = Buffer.concat(chunks);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } catch (error) {
    if (signal.aborted) throw new DOMException('Preview archive read aborted', 'AbortError');
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    stream.destroy();
    chunks.length = 0;
  }
}

export function createPreviewParseService(dependencies: PreviewParseServiceDependencies) {
  const jobs = new Map<string, PreviewParseJob>();
  const archiveReads = new Map<string, ArchiveReadJob>();
  const tombstones = new Map<string, CancellationTombstone>();
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const tombstoneMs = dependencies.tombstoneMs ?? CANCELLATION_TOMBSTONE_MS;
  const maxTombstones = dependencies.maxTombstones ?? MAX_CANCELLATION_TOMBSTONES;
  let activeJob: PreviewParseJob | null = null;
  let queuedJob: PreviewParseJob | null = null;
  let pumping = false;
  let disposed = false;

  function removeTombstone(key: string) {
    const tombstone = tombstones.get(key);
    if (!tombstone) return undefined;
    clearTimeout(tombstone.timer);
    tombstones.delete(key);
    return tombstone.reason;
  }

  function setTombstone(key: string, reason: PreviewParseCancelRequest['reason']) {
    removeTombstone(key);
    const timer = setTimeout(() => tombstones.delete(key), tombstoneMs);
    timer.unref?.();
    tombstones.set(key, { reason, timer });
    while (tombstones.size > maxTombstones) {
      const oldestKey = tombstones.keys().next().value as string | undefined;
      if (!oldestKey) break;
      removeTombstone(oldestKey);
    }
  }

  function settle(
    job: PreviewParseJob,
    message?: PreviewParsePortMessage,
  ) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    job.removeCloseListener?.();
    job.removeCloseListener = null;
    jobs.delete(requestKey(job.ownerId, job.request.requestId));
    if (queuedJob === job) queuedJob = null;
    try {
      if (message) {
        job.reply.postMessage(
          message,
          message.type === 'done' ? collectTransferables(message.preview) : undefined,
        );
      }
    } catch {
      // The requesting renderer may have closed its port while work settled.
    } finally {
      try { job.reply.close(); } catch { /* Already closed. */ }
    }
  }

  function cancellationMessage(requestId: string, reason: PreviewParseCancelRequest['reason']): PreviewParsePortMessage {
    return { requestId, type: 'cancelled', reason };
  }

  function cancelJob(job: PreviewParseJob, reason: PreviewParseCancelRequest['reason']): Promise<void> {
    if (job.settled) return job.stopRuntime ?? Promise.resolve();
    job.abortController.abort(reason);
    job.signalAbort();
    settle(job, cancellationMessage(job.request.requestId, reason));
    if (activeJob === job && !job.stopRuntime) {
      job.stopRuntime = Promise.resolve()
        .then(() => dependencies.restartRuntime())
        .catch((error: unknown) => {
          console.warn('[PreviewParse] Could not stop obsolete parser runtime:', error);
        });
    }
    return job.stopRuntime ?? Promise.resolve();
  }

  function createJob(
    ownerId: number,
    request: PreviewParseRequest,
    reply: PreviewParseReplyPort,
  ): PreviewParseJob {
    const abortController = new AbortController();
    let signalAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { signalAbort = resolve; });
    const job: PreviewParseJob = {
      ownerId,
      request,
      reply,
      abortController,
      aborted,
      signalAbort,
      timer: setTimeout(() => {
        void cancelJob(job, 'timeout');
      }, timeoutMs),
      removeCloseListener: null,
      settled: false,
      stopRuntime: null,
    };
    job.timer.unref?.();
    job.removeCloseListener = reply.onClose?.(() => {
      void cancelJob(job, 'disposed');
    }) ?? null;
    return job;
  }

  async function execute(job: PreviewParseJob) {
    const runtimeWork = (async () => {
      await dependencies.ensureRuntime();
      if (job.abortController.signal.aborted) return;
      let archiveBuffer: ArrayBuffer | undefined;
      if (parseArchiveEntryPath(job.request.path)) {
        if (!dependencies.readArchiveEntryBuffer) {
          throw new Error('Archive preview reading is unavailable');
        }
        archiveBuffer = await dependencies.readArchiveEntryBuffer(job.request, job.abortController.signal);
        if (job.abortController.signal.aborted) return;
      }
      return dependencies.runParse(job.request, archiveBuffer, job.reply.transferPort?.());
    })();

    try {
      const preview = await Promise.race([
        runtimeWork,
        job.aborted.then(() => undefined),
      ]);
      if (preview && !job.settled) {
        settle(job, { requestId: job.request.requestId, type: 'done', preview });
      } else if (!job.settled) {
        // Electron's owned preview renderer already transferred its meshes directly to the requester.
        settle(job);
      }
    } catch (error) {
      if (!job.settled) {
        settle(job, {
          requestId: job.request.requestId,
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (job.stopRuntime) await job.stopRuntime;
      if (!job.settled) {
        settle(job, {
          requestId: job.request.requestId,
          type: 'error',
          error: 'Preview parse returned no result',
        });
      }
    }
  }

  async function pump() {
    if (pumping || disposed) return;
    pumping = true;
    try {
      while (queuedJob && !disposed) {
        const job = queuedJob;
        queuedJob = null;
        if (job.settled) continue;
        activeJob = job;
        await execute(job);
        if (activeJob === job) activeJob = null;
      }
    } finally {
      pumping = false;
      if (queuedJob && !disposed) void pump();
    }
  }

  function request(ownerId: number, parseRequest: PreviewParseRequest, reply: PreviewParseReplyPort) {
    if (disposed) {
      reply.postMessage({ requestId: parseRequest.requestId, type: 'error', error: 'Preview parser is shutting down' });
      reply.close();
      return;
    }
    const key = requestKey(ownerId, parseRequest.requestId);
    const cancelledBeforeRequest = removeTombstone(key);
    if (cancelledBeforeRequest) {
      reply.postMessage(cancellationMessage(parseRequest.requestId, cancelledBeforeRequest));
      reply.close();
      return;
    }
    if (jobs.has(key) || archiveReads.has(key)) {
      reply.postMessage({ requestId: parseRequest.requestId, type: 'error', error: 'Duplicate preview request ID' });
      reply.close();
      return;
    }

    try {
      dependencies.validateIndexedRequest?.(parseRequest);
    } catch (error) {
      reply.postMessage({ requestId: parseRequest.requestId, type: 'error', error: error instanceof Error ? error.message : String(error) });
      reply.close();
      return;
    }

    const job = createJob(ownerId, parseRequest, reply);
    jobs.set(key, job);
    if (activeJob) {
      if (queuedJob) void cancelJob(queuedJob, 'replaced');
      queuedJob = job;
      void cancelJob(activeJob, 'replaced');
    } else {
      if (queuedJob) void cancelJob(queuedJob, 'replaced');
      queuedJob = job;
    }
    void pump();
  }

  async function cancel(ownerId: number, cancelRequest: PreviewParseCancelRequest) {
    const key = requestKey(ownerId, cancelRequest.requestId);
    const job = jobs.get(key);
    const archiveRead = archiveReads.get(key);
    if (archiveRead) {
      archiveRead.controller.abort(cancelRequest.reason);
      archiveRead.signalAbort();
      return;
    }
    if (!job) {
      if (!disposed) setTombstone(key, cancelRequest.reason);
      return;
    }
    await cancelJob(job, cancelRequest.reason);
  }

  async function readPreviewArchiveBufferForRenderer(ownerId: number, request: PreviewParseRequest): Promise<ArrayBuffer> {
    const key = requestKey(ownerId, request.requestId);
    const cancelledBeforeStart = removeTombstone(key);
    if (cancelledBeforeStart) throw new DOMException(`Preview archive read ${cancelledBeforeStart}`, 'AbortError');
    if (disposed) throw new Error('Preview parser is shutting down');
    if (jobs.has(key) || archiveReads.has(key)) throw new Error('Duplicate preview request ID');
    if (!dependencies.readArchiveEntryBuffer) throw new Error('Preview archive reading is unavailable');
    dependencies.validateIndexedRequest?.(request);

    const controller = new AbortController();
    let signalAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { signalAbort = resolve; });
    const readJob = { ownerId, request, controller, aborted, signalAbort } satisfies ArchiveReadJob;
    archiveReads.set(key, readJob);
    try {
      const buffer = await Promise.race([
        dependencies.readArchiveEntryBuffer(request, controller.signal),
        aborted.then(() => undefined),
      ]);
      if (!buffer || controller.signal.aborted) throw new DOMException('Preview archive read aborted', 'AbortError');
      return buffer;
    } finally {
      if (archiveReads.get(key) === readJob) archiveReads.delete(key);
    }
  }

  async function cancelRequester(ownerId: number) {
    const owned = [...jobs.values()].filter((job) => job.ownerId === ownerId);
    const reads = [...archiveReads.values()].filter((job) => job.ownerId === ownerId);
    for (const job of reads) {
      job.controller.abort('disposed');
      job.signalAbort();
    }
    await Promise.all(owned.map((job) => cancelJob(job, 'disposed')));
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    for (const tombstone of tombstones.values()) clearTimeout(tombstone.timer);
    tombstones.clear();
    for (const read of archiveReads.values()) {
      read.controller.abort('disposed');
      read.signalAbort();
    }
    const pending = [...jobs.values()];
    await Promise.all(pending.map((job) => cancelJob(job, 'disposed')));
  }

  return { request, cancel, cancelRequester, readPreviewArchiveBufferForRenderer, dispose };
}

export { collectTransferables as collectPreviewTransferables };

function adaptReplyPort(
  port: MessagePortMain,
  sendControl: (control: PreviewParseControlData) => void,
): PreviewParseReplyPort {
  let transferred = false;
  return {
    postMessage(message) {
      if (!transferred) {
        port.postMessage(message);
        return;
      }
      if (message.type === 'cancelled') {
        sendControl({ requestId: message.requestId, type: 'cancelled', reason: message.reason });
      } else if (message.type === 'error') {
        sendControl({ requestId: message.requestId, type: 'error', error: message.error.slice(0, 2048) });
      } else {
        sendControl({ requestId: message.requestId, type: 'error', error: 'Unexpected main-thread preview payload' });
      }
    },
    close() {
      port.close();
    },
    transferPort() {
      transferred = true;
      return port;
    },
  };
}

export function registerPreviewParseHandler(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null,
  previewRuntime: PreviewWindowRuntime,
) {
  const service = createPreviewParseService({
    ensureRuntime: async () => { await previewRuntime.ensureReady(); },
    runParse: (request, sourceBuffer, responsePort) => {
      if (!responsePort) throw new Error('Requester response port is unavailable');
      return previewRuntime.parse(request, responsePort, sourceBuffer);
    },
    restartRuntime: () => previewRuntime.restart(),
    validateIndexedRequest: (request) => validateIndexedPreviewRequest(getDb(), request),
    readArchiveEntryBuffer: (request, signal) => readIndexedPreviewArchiveBuffer(getDb(), request, signal),
  });
  const requesterCleanup = new Map<number, () => void>();

  const assertMainRequester = (sender: WebContents) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== sender) {
      throw new Error('Preview parsing is available only to the main window');
    }
  };

  const trackRequester = (sender: WebContents) => {
    if (requesterCleanup.has(sender.id)) return;
    let cleaned = false;
    const onGone = () => {
      if (cleaned) return;
      cleaned = true;
      cleanup();
      requesterCleanup.delete(sender.id);
      void service.cancelRequester(sender.id);
    };
    const onNavigation = (_event: Electron.Event, _url: string, _isInPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame) onGone();
    };
    const cleanup = () => {
      sender.removeListener('destroyed', onGone);
      sender.removeListener('render-process-gone', onGone);
      sender.removeListener('did-start-navigation', onNavigation);
    };
    sender.once('destroyed', onGone);
    sender.once('render-process-gone', onGone);
    sender.on('did-start-navigation', onNavigation);
    requesterCleanup.set(sender.id, cleanup);
  };

  function cancelHandler(event: Electron.IpcMainEvent, payload: unknown) {
    try {
      void service.cancel(event.sender.id, parsePreviewParseCancelRequest(payload));
    } catch (error) {
      console.warn('[PreviewParse] Ignored invalid cancellation request:', error);
    }
  }

  function readyHandler(event: Electron.IpcMainEvent) {
    if (!previewRuntime.markReady(event.sender.id)) {
      console.warn('[PreviewParse] Ignored readiness from an unowned preview renderer');
    }
  }

  function settledHandler(event: Electron.IpcMainEvent, payload: unknown) {
    try {
      const settlement = parsePreviewParseSettlementRequest(payload);
      if (!previewRuntime.markParseSettled(event.sender.id, settlement)) {
        console.warn('[PreviewParse] Ignored settlement from an unowned or inactive preview request');
      }
    } catch (error) {
      console.warn('[PreviewParse] Ignored invalid settlement:', error);
    }
  }

  ipcMain.handle(IPC.REQUEST_PREVIEW_PARSE, (event, payload: unknown) => {
    assertMainRequester(event.sender);
    const request = parsePreviewParseRequest(payload);
    trackRequester(event.sender);

    const channel = new MessageChannelMain();
    try {
      const portData: PreviewParsePortData = { requestId: request.requestId };
      event.sender.postMessage(IPC.PREVIEW_PARSE_PORT, portData, [channel.port1]);
      const requester = event.sender;
      service.request(event.sender.id, request, adaptReplyPort(channel.port2, (control) => {
        if (!requester.isDestroyed()) requester.send(IPC.PREVIEW_PARSE_CONTROL, control);
      }));
      return true;
    } catch (error) {
      channel.port1.close();
      channel.port2.close();
      throw error;
    }
  });

  ipcMain.handle(IPC.READ_PREVIEW_ARCHIVE_BUFFER, (event, payload: unknown) => {
    assertMainRequester(event.sender);
    const request = parsePreviewParseRequest(payload);
    trackRequester(event.sender);
    return service.readPreviewArchiveBufferForRenderer(event.sender.id, request);
  });

  ipcMain.on(IPC.CANCEL_PREVIEW_PARSE, cancelHandler);
  ipcMain.on(IPC.PREVIEW_RUNTIME_READY, readyHandler);
  ipcMain.on(IPC.PREVIEW_PARSE_SETTLED, settledHandler);

  return {
    service,
    async dispose() {
      for (const cleanup of requesterCleanup.values()) cleanup();
      requesterCleanup.clear();
      await service.dispose();
      await previewRuntime.close();
      ipcMain.removeHandler(IPC.REQUEST_PREVIEW_PARSE);
      ipcMain.removeHandler(IPC.READ_PREVIEW_ARCHIVE_BUFFER);
      ipcMain.removeListener(IPC.CANCEL_PREVIEW_PARSE, cancelHandler);
      ipcMain.removeListener(IPC.PREVIEW_RUNTIME_READY, readyHandler);
      ipcMain.removeListener(IPC.PREVIEW_PARSE_SETTLED, settledHandler);
    },
  };
}
