import ParserWorker from './workers/parser.worker?worker';
import type { PreparedPreviewMeshes } from '../../shared/types';
import type { PreviewParseRequest } from '../../shared/previewContracts';
import { isArchiveEntryPath } from '../../shared/archivePaths';
import { dispatchAbortablePreviewRequest } from './previewRequest';

interface PreviewStrategyArgs {
  fileUrl: string;
  extension: string;
  contentRevision: number;
  requestId: string;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}

interface PreviewParseStrategy {
  loadPrepared(args: PreviewStrategyArgs): Promise<PreparedPreviewMeshes>;
}

function toPreviewUrl(fileUrl: string) {
  return fileUrl.startsWith('polytray://local/')
    ? fileUrl
    : `polytray://local/${encodeURIComponent(fileUrl)}`;
}

function createRequest(args: PreviewStrategyArgs): PreviewParseRequest {
  return {
    requestId: args.requestId,
    path: args.fileUrl,
    extension: args.extension,
    contentRevision: args.contentRevision,
  };
}

function makeAbortError() {
  return new DOMException('Preview parse aborted', 'AbortError');
}

async function loadModelBuffer(args: PreviewStrategyArgs) {
  if (args.signal.aborted) throw makeAbortError();
  if (isArchiveEntryPath(args.fileUrl)) {
    const request = createRequest(args);
    return readArchiveBufferWithSignal(request, args.signal);
  }

  const response = await fetch(toPreviewUrl(args.fileUrl), { signal: args.signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${response.url}: ${response.status}`);
  }
  return response.arrayBuffer();
}

function readArchiveBufferWithSignal(request: PreviewParseRequest, signal: AbortSignal) {
  return dispatchAbortablePreviewRequest(
    request,
    signal,
    (parseRequest) => window.polytray.readPreviewArchiveBuffer(parseRequest),
    (requestId) => window.polytray.cancelPreviewParse(requestId, 'replaced'),
  );
}

const workerStrategy: PreviewParseStrategy = {
  async loadPrepared(args) {
    if (args.onProgress) args.onProgress(-1);
    const buffer = await loadModelBuffer(args);
    if (args.signal.aborted) throw makeAbortError();

    return new Promise<PreparedPreviewMeshes>((resolve, reject) => {
      const worker = new ParserWorker();
      let settled = false;
      const cleanup = () => {
        args.signal.removeEventListener('abort', abortHandler);
        worker.terminate();
      };
      const settle = (error?: unknown, result?: PreparedPreviewMeshes) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error !== undefined) reject(error instanceof Error ? error : new Error(String(error)));
        else if (result) resolve(result);
        else reject(new Error('Parser worker returned no prepared model'));
      };
      const abortHandler = () => settle(makeAbortError());
      args.signal.addEventListener('abort', abortHandler, { once: true });
      if (args.signal.aborted) {
        abortHandler();
        return;
      }
      worker.onmessage = (event) => {
        if (event.data.error) settle(new Error(event.data.error));
        else settle(undefined, event.data as PreparedPreviewMeshes);
      };
      worker.onerror = (event) => settle(event);
      worker.postMessage({ buffer, extension: args.extension }, [buffer]);
    });
  },
};

const hiddenRendererStrategy: PreviewParseStrategy = {
  async loadPrepared(args) {
    if (args.onProgress) args.onProgress(-1);
    const request = createRequest(args);
    const prepared = await dispatchAbortablePreviewRequest(
      request,
      args.signal,
      (parseRequest) => window.polytray.requestPreviewParse(parseRequest),
      (requestId) => window.polytray.cancelPreviewParse(requestId, 'replaced'),
    );
    return prepared;
  },
};

function resolvePreviewStrategy(extension: string): PreviewParseStrategy {
  if (extension.toLowerCase() === '3mf') return hiddenRendererStrategy;
  return workerStrategy;
}

export async function loadPreviewMeshes(args: {
  fileUrl: string;
  extension: string;
  contentRevision: number;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<PreparedPreviewMeshes> {
  if (args.signal.aborted) throw makeAbortError();
  const strategy = resolvePreviewStrategy(args.extension);
  return strategy.loadPrepared({
    ...args,
    requestId: crypto.randomUUID(),
  });
}
