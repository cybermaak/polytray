import type { IpcRenderer, IpcRendererEvent } from "electron";
import { IPC, type PreviewParsePortData, type PreviewParseRequestData, type SerializedMesh } from "../shared/types";

type PreviewBridgeWindow = Pick<Window, "addEventListener">;

interface PendingParse {
  resolve: (meshes: SerializedMesh[]) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

function collectMeshTransferables(meshes: SerializedMesh[]): ArrayBuffer[] {
  const transferables: ArrayBuffer[] = [];
  for (const mesh of meshes) {
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      if (attribute.array.buffer instanceof ArrayBuffer) transferables.push(attribute.array.buffer);
    }
    if (mesh.geometry.index?.array.buffer instanceof ArrayBuffer) {
      transferables.push(mesh.geometry.index.array.buffer);
    }
  }
  return transferables;
}

export function createPreviewBridge(
  ipcRenderer: Pick<IpcRenderer, "on" | "invoke">,
  bridgeWindow: PreviewBridgeWindow,
) {
  const pendingParses = new Map<string, PendingParse>();
  const hiddenPorts = new Map<string, MessagePort>();
  let hiddenParseListener: ((data: PreviewParseRequestData) => void) | null = null;

  ipcRenderer.on(IPC.PREVIEW_PARSE_PORT, (event: IpcRendererEvent, data: PreviewParsePortData) => {
    const pending = pendingParses.get(data.requestId);
    if (!pending) return;
    const [port] = event.ports;
    if (!port) {
      clearTimeout(pending.timeoutId);
      pendingParses.delete(data.requestId);
      pending.reject(new Error("Preview parse transport was not delivered"));
      return;
    }
    const finalize = () => {
      clearTimeout(pending.timeoutId);
      pendingParses.delete(data.requestId);
      port.close();
    };
    port.onmessage = (messageEvent) => {
      const payload = messageEvent.data as
        | { type: "done"; meshes: SerializedMesh[] }
        | { type: "error"; error: string };
      finalize();
      if (payload.type === "done") pending.resolve(payload.meshes);
      else pending.reject(new Error(payload.error));
    };
    port.start();
  });

  ipcRenderer.on(IPC.GENERATE_PREVIEW_PARSE_REQUEST, (event: IpcRendererEvent, data: PreviewParseRequestData) => {
    const [port] = event.ports;
    if (!port) return;
    hiddenPorts.set(data.requestId, port);
    port.start();
    hiddenParseListener?.(data);
  });

  bridgeWindow.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const payload = event.data as
      | { type: "__polytray-preview-parse-result"; requestId: string; meshes: SerializedMesh[] }
      | { type: "__polytray-preview-parse-error"; requestId: string; error: string }
      | undefined;
    if (!payload || (payload.type !== "__polytray-preview-parse-result" && payload.type !== "__polytray-preview-parse-error")) return;
    const port = hiddenPorts.get(payload.requestId);
    if (!port) return;
    hiddenPorts.delete(payload.requestId);
    if (payload.type === "__polytray-preview-parse-result") {
      port.postMessage({ type: "done", meshes: payload.meshes }, collectMeshTransferables(payload.meshes));
    } else {
      port.postMessage({ type: "error", error: payload.error });
    }
    port.close();
  });

  return {
    requestPreviewParse(filePath: string, ext: string): Promise<SerializedMesh[]> {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingParses.delete(requestId);
          reject(new Error("Preview parse timed out"));
        }, 120000);
        pendingParses.set(requestId, { resolve, reject, timeoutId });
        ipcRenderer.invoke(IPC.REQUEST_PREVIEW_PARSE, { requestId, filePath, ext } satisfies PreviewParseRequestData).catch((error) => {
          clearTimeout(timeoutId);
          pendingParses.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    onPreviewParseRequest(callback: (data: PreviewParseRequestData) => void) {
      hiddenParseListener = callback;
      return () => {
        if (hiddenParseListener === callback) hiddenParseListener = null;
      };
    },
  };
}
