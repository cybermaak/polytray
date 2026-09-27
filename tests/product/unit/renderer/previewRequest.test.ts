import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchAbortablePreviewRequest } from '../../../../src/renderer/lib/previewRequest';
import type { PreviewParseRequest } from '../../../../src/shared/previewContracts';

const request: PreviewParseRequest = {
  requestId: 'renderer-id',
  path: '/models/model.3mf',
  extension: '3mf',
  contentRevision: 3,
};

test('already-aborted renderer request never dispatches to preload', async () => {
  const controller = new AbortController();
  controller.abort();
  let dispatchCount = 0;
  await assert.rejects(
    dispatchAbortablePreviewRequest(request, controller.signal, async () => {
      dispatchCount += 1;
      return 'unexpected';
    }, () => {}),
    (error: Error) => error.name === 'AbortError',
  );
  assert.equal(dispatchCount, 0);
});

test('abort settles renderer request once and discards a late preload result', async () => {
  const controller = new AbortController();
  let dispatchCount = 0;
  let cancelCount = 0;
  let resolveLate!: (value: string) => void;
  const pending = dispatchAbortablePreviewRequest(
    request,
    controller.signal,
    () => {
      dispatchCount += 1;
      return new Promise<string>((resolve) => { resolveLate = resolve; });
    },
    (requestId) => { assert.equal(requestId, request.requestId); cancelCount += 1; },
  );
  assert.equal(dispatchCount, 1);
  controller.abort();
  await assert.rejects(pending, (error: Error) => error.name === 'AbortError');
  resolveLate('late result');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelCount, 1);
});
