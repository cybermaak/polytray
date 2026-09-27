/** Hidden-renderer 3MF parsing and response publication. */
import * as THREE from "three";
import { parseModelToGroup } from "./modelParsers";
import { collectSerializedPreviewMeshes } from "./meshSerialization";
import { isArchiveEntryPath } from "../../shared/archivePaths";

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    }
  });
}

export async function parsePreviewMeshes(arrayBuffer: ArrayBuffer, extension: string) {
  const parseStartedAt = performance.now();
  const group = await parseModelToGroup(arrayBuffer, extension);
  const parseDurationMs = performance.now() - parseStartedAt;
  try {
    if (group.children.length === 0) {
      return { meshes: [], transferables: [], parseDurationMs, serializeDurationMs: 0 };
    }
    const serializeStartedAt = performance.now();
    const serialized = collectSerializedPreviewMeshes(group);
    return {
      ...serialized,
      parseDurationMs,
      serializeDurationMs: performance.now() - serializeStartedAt,
    };
  } finally {
    disposeObject(group);
  }
}

async function readPreviewBuffer(filePath: string) {
  if (isArchiveEntryPath(filePath)) return window.polytray.readFileBuffer(filePath);
  const url = `polytray://local/${encodeURIComponent(filePath)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

export function initPreviewParseRenderer() {
  return window.polytray.onPreviewParseRequest(async (data) => {
    const { filePath, ext } = data;
    const totalStartedAt = performance.now();
    try {
      const fetchStartedAt = performance.now();
      const buffer = await readPreviewBuffer(filePath);
      const fetchDurationMs = performance.now() - fetchStartedAt;
      const { meshes, transferables, parseDurationMs, serializeDurationMs } = await parsePreviewMeshes(buffer, ext);
      const payloadBytes = transferables.reduce((total, transferable) => total + transferable.byteLength, 0);
      const totalDurationMs = performance.now() - totalStartedAt;

      window.polytray.emitPreviewMetric({ source: "hidden-renderer", phase: "fetch", filePath, ext, durationMs: fetchDurationMs });
      window.polytray.emitPreviewMetric({ source: "hidden-renderer", phase: "parse", filePath, ext, durationMs: parseDurationMs, meshCount: meshes.length });
      window.polytray.emitPreviewMetric({ source: "hidden-renderer", phase: "serialize", filePath, ext, durationMs: serializeDurationMs, meshCount: meshes.length, payloadBytes });
      window.polytray.emitPreviewMetric({ source: "hidden-renderer", phase: "background-total", filePath, ext, durationMs: totalDurationMs, meshCount: meshes.length, payloadBytes });
      window.postMessage({ type: "__polytray-preview-parse-result", requestId: data.requestId, meshes }, "*", transferables);
    } catch (error) {
      console.warn("Preview parse failed for", filePath, error);
      window.postMessage({
        type: "__polytray-preview-parse-error",
        requestId: data.requestId,
        error: error instanceof Error ? error.message : String(error),
      }, "*");
    }
  });
}
