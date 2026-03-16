import ParserWorker from "./workers/parser.worker?worker";
import type { SerializedMesh } from "../../shared/types";
import { isArchiveEntryPath } from "../../shared/archivePaths";

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

async function loadModelBuffer(fileUrl: string, signal: AbortSignal) {
  if (isArchiveEntryPath(fileUrl)) {
    return window.polytray.readFileBuffer(fileUrl);
  }

  const loadUrl = toPreviewUrl(fileUrl);
  const response = await fetch(loadUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load ${loadUrl}: status ${response.status}`);
  }

  return response.arrayBuffer();
}

const workerStrategy: PreviewParseStrategy = {
  async loadMeshes({ fileUrl, extension, signal, onProgress }) {
    if (onProgress) onProgress(-1);

    const buffer = await loadModelBuffer(fileUrl, signal);
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
