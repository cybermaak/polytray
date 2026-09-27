import type { PreviewParseRequest } from '../../shared/previewContracts';

function makeAbortError() {
  return new DOMException('Preview parse aborted', 'AbortError');
}

/** Link a renderer-only AbortSignal to an ID-based preload request without crossing contextBridge. */
export function dispatchAbortablePreviewRequest<T>(
  request: PreviewParseRequest,
  signal: AbortSignal,
  dispatch: (request: PreviewParseRequest) => Promise<T>,
  cancel: (requestId: string) => void,
): Promise<T> {
  if (signal.aborted) return Promise.reject(makeAbortError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      cancel(request.requestId);
      settle(() => reject(makeAbortError()));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    dispatch(request).then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
  });
}
