import * as THREE from 'three';
import { parseModelToGroup } from './modelParsers';
import { collectSerializedPreviewMeshes } from './meshSerialization';
import type { PreparedPreview, PreviewOrientationTransform } from '../../shared/previewContracts';
import type { PreviewParseDispatchData } from '../../shared/types';
import { isArchiveEntryPath } from '../../shared/archivePaths';
import { prepareModelGroup } from './meshPreparation';
import { measureFast3mfBuild, type Fast3mfBuildMeasurement } from '../../shared/model/fast3mfGeometry';
import type { ModelMeasurement } from '../../shared/measurementContracts';

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

export async function parsePreviewMeshes(arrayBuffer: ArrayBuffer, extension: string, filePath = ''): Promise<PreparedPreview> {
  const parseStartedAt = performance.now();
  const sourceMeasurePromise = extension.toLowerCase() === '3mf'
    ? measureFast3mfBuild(arrayBuffer)
    : Promise.resolve(null);
  const group = await parseModelToGroup(arrayBuffer, extension);
  const parseDurationMs = performance.now() - parseStartedAt;
  try {
    const sourceMeasure = await sourceMeasurePromise;
    const preparationStartedAt = performance.now();
    const prepared = prepareModelGroup(group);
    const preparationDurationMs = performance.now() - preparationStartedAt;
    const serializationStartedAt = performance.now();
    const serialized = collectSerializedPreviewMeshes(group);
    const serializationDurationMs = performance.now() - serializationStartedAt;
    const preview: PreparedPreview = {
      meshes: serialized.meshes,
      orientation: prepared.orientation.toArray() as PreviewOrientationTransform,
      bounds: prepared.bounds,
      ...(sourceMeasure ? { measurements: toPreviewMeasurement(sourceMeasure) } : {}),
    };
    const payloadBytes = serialized.transferables.reduce((total, transferable) => total + transferable.byteLength, 0);
    window.polytray.emitPreviewMetric({ source: 'hidden-renderer', phase: 'parse', filePath, ext: extension, durationMs: parseDurationMs, meshCount: preview.meshes.length });
    window.polytray.emitPreviewMetric({ source: 'hidden-renderer', phase: 'prepare', filePath, ext: extension, durationMs: preparationDurationMs, meshCount: preview.meshes.length });
    window.polytray.emitPreviewMetric({ source: 'hidden-renderer', phase: 'serialize', filePath, ext: extension, durationMs: serializationDurationMs, meshCount: preview.meshes.length, payloadBytes });
    return preview;
  } finally {
    disposeObject(group);
  }
}

function toPreviewMeasurement(source: Fast3mfBuildMeasurement): ModelMeasurement {
  if (source.status === 'available') {
    return {
      version: 1,
      ...source.dimensions,
      unit: 'mm',
      basis: 'source-build',
      status: 'verified',
    };
  }
  const reason = source.measurement.reason.toLowerCase();
  const code = /unit/.test(reason)
    ? 'unknown-units'
    : /extension|support/.test(reason)
      ? 'unsupported-structure'
      : 'invalid-geometry';
  return {
    version: 1,
    x: null,
    y: null,
    z: null,
    unit: source.measurement.unit,
    basis: 'source-build',
    status: 'unavailable',
    reason: code,
  };
}

async function readPreviewBuffer(data: PreviewParseDispatchData) {
  if (data.sourceBuffer) return data.sourceBuffer;
  if (isArchiveEntryPath(data.request.path)) throw new Error('Indexed archive preview buffer was not supplied by the main process');
  const url = `polytray://local/${encodeURIComponent(data.request.path)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

export function initPreviewParseRenderer() {
  let active = true;
  let heldFirstParse = false;
  const unsubscribe = window.polytray.onPreviewParseRequest(async (data) => {
    if (!active) return;
    const { requestId, path, extension } = data.request;
    const testQuery = new URLSearchParams(window.location.search);
    const requestedHold = testQuery.get('testHoldFirstParseMs');
    const holdRequestId = testQuery.get('testHoldRequestId');
    const holdMs = requestedHold ? Number.parseInt(requestedHold, 10) : 0;
    if (!heldFirstParse && requestId === holdRequestId && Number.isSafeInteger(holdMs) && holdMs > 0) {
      heldFirstParse = true;
      console.info('[PreviewTest] synchronous hold started', { requestId, holdMs });
      window.polytray.emitPreviewMetric({
        source: 'hidden-renderer',
        phase: 'fetch',
        filePath: `__preview_test_hold__${requestId}`,
        ext: extension,
        durationMs: 0,
      });
      const deadline = performance.now() + holdMs;
      while (performance.now() < deadline) { /* Deliberately uninterruptible fixture barrier. */ }
      console.info('[PreviewTest] synchronous hold completed', { requestId });
    }
    const totalStartedAt = performance.now();
    try {
      const fetchStartedAt = performance.now();
      const buffer = await readPreviewBuffer(data);
      const fetchDurationMs = performance.now() - fetchStartedAt;
      const preview = await parsePreviewMeshes(buffer, extension, path);
      if (!active) return;
      window.polytray.emitPreviewMetric({ source: 'hidden-renderer', phase: 'fetch', filePath: path, ext: extension, durationMs: fetchDurationMs });
      window.polytray.emitPreviewMetric({ source: 'hidden-renderer', phase: 'background-total', filePath: path, ext: extension, durationMs: performance.now() - totalStartedAt, meshCount: preview.meshes.length });
      window.postMessage({ type: '__polytray-preview-parse-result', requestId, preview }, '*', collectPreviewTransferables(preview));
    } catch (error) {
      if (!active) return;
      console.warn('Preview parse failed for', path, error);
      window.postMessage({
        type: '__polytray-preview-parse-error',
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }, '*');
    }
  });
  window.polytray.markPreviewRuntimeReady();
  return () => {
    active = false;
    unsubscribe();
  };
}

function collectPreviewTransferables(preview: PreparedPreview): ArrayBuffer[] {
  const transferables = new Set<ArrayBuffer>();
  for (const mesh of preview.meshes) {
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      if (attribute.array.buffer instanceof ArrayBuffer) transferables.add(attribute.array.buffer);
    }
    if (mesh.geometry.index?.array.buffer instanceof ArrayBuffer) transferables.add(mesh.geometry.index.array.buffer);
  }
  return [...transferables];
}
