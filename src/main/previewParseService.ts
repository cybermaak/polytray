import type { IpcMain, MessageChannelMain, WebContents, BrowserWindow } from "electron";
import { IPC, type PreviewParsePortData, type PreviewParseRequestData } from "../shared/types";
import { parsePreviewParseRequest } from "./ipc/runtimeValidation";

export type PreviewWindowProvider = () => BrowserWindow | null;
export type PreviewMessageChannelFactory = () => MessageChannelMain;

/** Forward one renderer-owned parse request to the hidden DOM-capable renderer. */
export function forwardPreviewParseRequest(
  requester: Pick<WebContents, "postMessage">,
  request: PreviewParseRequestData,
  getPreviewWindow: PreviewWindowProvider,
  createMessageChannel: PreviewMessageChannelFactory,
): void {
  const previewWindow = getPreviewWindow();
  if (!previewWindow || previewWindow.isDestroyed()) {
    throw new Error("Background preview parser is unavailable");
  }

  const channel = createMessageChannel();
  const portPayload: PreviewParsePortData = { requestId: request.requestId };
  requester.postMessage(IPC.PREVIEW_PARSE_PORT, portPayload, [channel.port1]);
  previewWindow.webContents.postMessage(
    IPC.GENERATE_PREVIEW_PARSE_REQUEST,
    request,
    [channel.port2],
  );
}

/** Register the existing request channel while keeping window ownership injected. */
export function registerPreviewParseHandler(
  ipcMain: Pick<IpcMain, "handle">,
  getPreviewWindow: PreviewWindowProvider,
  createMessageChannel: PreviewMessageChannelFactory,
): void {
  ipcMain.handle(IPC.REQUEST_PREVIEW_PARSE, async (event, request: PreviewParseRequestData) => {
    forwardPreviewParseRequest(
      event.sender,
      parsePreviewParseRequest(request),
      getPreviewWindow,
      createMessageChannel,
    );
    return true;
  });
}
