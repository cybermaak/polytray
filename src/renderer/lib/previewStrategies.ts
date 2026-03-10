import ParserWorker from "./workers/parser.worker?worker";
import type { SerializedMesh } from "../../shared/types";

interface PreviewStrategyArgs {
  fileUrl: string;
  extension: string;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}

interface PreviewParseStrategy {
  loadMeshes(args: PreviewStrategyArgs): Promise<SerializedMesh[]>;
}

function toPreviewUrl(fileUrl: string) {
  return fileUrl.startsWith("polytray://local/")
    ? fileUrl
    : `polytray://local/${encodeURIComponent(fileUrl)}`;
}

const workerStrategy: PreviewParseStrategy = {
  async loadMeshes({ fileUrl, extension, signal, onProgress }) {
    const loadUrl = toPreviewUrl(fileUrl);
    if (onProgress) onProgress(-1);

    const response = await fetch(loadUrl, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load ${loadUrl}: status ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise<SerializedMesh[]>((resolve, reject) => {
      const worker = new ParserWorker();

      const cleanup = () => {
        worker.terminate();
      };

      worker.onmessage = (e) => {
        if (signal.aborted) {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        if (e.data.error) {
          cleanup();
          reject(new Error(e.data.error));
          return;
        }

        cleanup();
        resolve(e.data.meshes as SerializedMesh[]);
      };

      worker.onerror = (err) => {
        cleanup();
        reject(err);
      };

      worker.postMessage({ buffer, extension }, [buffer]);

      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  },
};

const hiddenRendererStrategy: PreviewParseStrategy = {
  async loadMeshes({ fileUrl, extension, signal, onProgress }) {
    if (onProgress) onProgress(-1);
    const meshes = await window.polytray.requestPreviewParse(fileUrl, extension);
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return meshes;
  },
};

function resolvePreviewStrategy(extension: string): PreviewParseStrategy {
  if (extension.toLowerCase() === "3mf") {
    return hiddenRendererStrategy;
  }

  return workerStrategy;
}

export async function loadPreviewMeshes(args: PreviewStrategyArgs) {
  const strategy = resolvePreviewStrategy(args.extension);
  return strategy.loadMeshes(args);
}
