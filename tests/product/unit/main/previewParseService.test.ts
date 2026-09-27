import assert from "node:assert/strict";
import test from "node:test";
import { forwardPreviewParseRequest } from "../../../../src/main/previewParseService";
import { IPC } from "../../../../src/shared/types";

test("forwards a preview request through a dedicated message channel", () => {
  const sent: Array<{ target: string; channel: string; data: unknown; port: unknown }> = [];
  const requester = {
    postMessage: (channel: string, data: unknown, ports: unknown[]) => {
      sent.push({ target: "requester", channel, data, port: ports[0] });
    },
  };
  const previewWindow = {
    isDestroyed: () => false,
    webContents: {
      postMessage: (channel: string, data: unknown, ports: unknown[]) => {
        sent.push({ target: "preview", channel, data, port: ports[0] });
      },
    },
  };
  const port1 = { name: "renderer-port" };
  const port2 = { name: "preview-port" };

  forwardPreviewParseRequest(
    requester as never,
    { requestId: "request-1", filePath: "/models/a.3mf", ext: "3mf" },
    () => previewWindow as never,
    () => ({ port1, port2 } as never),
  );

  assert.deepEqual(sent, [
    { target: "requester", channel: IPC.PREVIEW_PARSE_PORT, data: { requestId: "request-1" }, port: port1 },
    { target: "preview", channel: IPC.GENERATE_PREVIEW_PARSE_REQUEST, data: { requestId: "request-1", filePath: "/models/a.3mf", ext: "3mf" }, port: port2 },
  ]);
});

test("rejects before allocating a transport when the preview window is unavailable", () => {
  let channelCreated = false;
  assert.throws(
    () => forwardPreviewParseRequest({ postMessage() {} } as never, { requestId: "r", filePath: "/a", ext: "3mf" }, () => null, () => {
      channelCreated = true;
      return {} as never;
    }),
    /Background preview parser is unavailable/,
  );
  assert.equal(channelCreated, false);
});
