/**
 * thumbnailRenderer.ts — Offscreen thumbnail generation for 3D models.
 *
 * Handles both the IPC-driven thumbnail pipeline (requests from main process)
 * and the Three.js offscreen rendering (hidden canvas).
 */
import * as THREE from "three";
import { VIEWER_CONFIG } from "./viewerConfig";
import { parseModelToGroup, setModelColor } from "./modelParsers";
import { applySmartOrientation } from "./orientation";
import { computeCameraFit } from "./cameraUtils";
import { collectSerializedPreviewMeshes } from "./meshSerialization";
import { isArchiveEntryPath } from "../../shared/archivePaths";

// ── Thumbnail Rendering State ─────────────────────────────────────

interface ThumbState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
}

const thumbState: ThumbState = {
  renderer: null,
  scene: null,
  camera: null,
};

function ensureThumbnailRenderer(canvas: HTMLCanvasElement) {
  const canvasSize = canvas.width || VIEWER_CONFIG.thumbnail.size;

  // Re-create if canvas size changed (thumbQuality setting changed)
  if (
    thumbState.renderer &&
    (thumbState.renderer.domElement.width !== canvasSize ||
      thumbState.renderer.domElement.height !== canvasSize)
  ) {
    thumbState.renderer.dispose();
    thumbState.renderer = null;
    thumbState.scene = null;
    thumbState.camera = null;
  }

  if (thumbState.renderer) return;

  thumbState.renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  });
  thumbState.renderer.setSize(canvasSize, canvasSize);
  thumbState.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  thumbState.renderer.toneMappingExposure = VIEWER_CONFIG.exposure;

  const { fov, near, far } = VIEWER_CONFIG.camera;
  thumbState.camera = new THREE.PerspectiveCamera(fov, 1, near, far);

  thumbState.scene = new THREE.Scene();

  const TL = VIEWER_CONFIG.thumbnailLighting;

  const ambient = new THREE.AmbientLight(
    TL.ambient.color,
    TL.ambient.intensity,
  );
  thumbState.scene.add(ambient);

  const hemi = new THREE.HemisphereLight(
    TL.hemisphere.skyColor,
    TL.hemisphere.groundColor,
    TL.hemisphere.intensity,
  );
  thumbState.scene.add(hemi);

  const dirLight = new THREE.DirectionalLight(TL.key.color, TL.key.intensity);
  dirLight.position.set(...TL.key.position);
  thumbState.scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(
    TL.fill.color,
    TL.fill.intensity,
  );
  fillLight.position.set(...TL.fill.position);
  thumbState.scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(TL.rim.color, TL.rim.intensity);
  rimLight.position.set(...TL.rim.position);
  thumbState.scene.add(rimLight);
}

// ── Dispose Helper ────────────────────────────────────────────────

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m: THREE.Material) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
}

// ── Core Render Function ──────────────────────────────────────────

export async function renderThumbnail(
  arrayBuffer: ArrayBuffer,
  extension: string,
  canvas: HTMLCanvasElement,
  color: string,
): Promise<string | null> {
  ensureThumbnailRenderer(canvas);
  setModelColor(color);

  // Yield to let the UI paint before the heavy parsing begins
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  const group = await parseModelToGroup(arrayBuffer, extension);

  if (group.children.length === 0) {
    return null;
  }

  // Yield after parsing (the heaviest step) to let the UI breathe
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  // Apply smart orientation heuristics
  applySmartOrientation(group);

  // Yield after orientation computation
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  // Normalize scale
  const scaledBox = new THREE.Box3().setFromObject(group);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
  if (maxDim > 0) {
    const scale = VIEWER_CONFIG.normalizeScale / maxDim;
    group.scale.set(scale, scale, scale);
    group.updateMatrixWorld(true);
  }

  thumbState.scene!.add(group);

  // Fit camera using shared logic
  computeCameraFit(group, thumbState.camera!);

  thumbState.renderer!.render(thumbState.scene!, thumbState.camera!);

  // Get data URL
  const dataUrl = canvas.toDataURL("image/png");

  // Cleanup
  thumbState.scene!.remove(group);
  disposeObject(group);

  return dataUrl;
}

export async function parsePreviewMeshes(
  arrayBuffer: ArrayBuffer,
  extension: string,
): Promise<
  ReturnType<typeof collectSerializedPreviewMeshes> & {
    parseDurationMs: number;
    serializeDurationMs: number;
  }
> {
  const parseStartedAt = performance.now();
  const group = await parseModelToGroup(arrayBuffer, extension);
  const parseDurationMs = performance.now() - parseStartedAt;

  try {
    if (group.children.length === 0) {
      return {
        meshes: [],
        transferables: [],
        parseDurationMs,
        serializeDurationMs: 0,
      };
    }

    const serializeStartedAt = performance.now();
    const serialized = collectSerializedPreviewMeshes(group);
    const serializeDurationMs = performance.now() - serializeStartedAt;

    return {
      ...serialized,
      parseDurationMs,
      serializeDurationMs,
    };
  } finally {
    disposeObject(group);
  }
}

async function readPreviewBuffer(filePath: string) {
  if (isArchiveEntryPath(filePath)) {
    return window.polytray.readFileBuffer(filePath);
  }

  const url = `polytray://local/${encodeURIComponent(filePath)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.arrayBuffer();
}

// ── IPC-Driven Thumbnail Pipeline ─────────────────────────────────

/**
 * Initializes the thumbnail generator that listens for requests from the main process.
 * When a thumbnail request comes in, we render the 3D model on a hidden canvas
 * and send the result back.
 */
export function initThumbnailGenerator(canvas: HTMLCanvasElement) {
  const cleanup = window.polytray.onThumbnailRequest(async (data) => {
    const { filePath, ext, thumbPath, color } = data;

    try {
      const buffer = await readPreviewBuffer(filePath);
      const dataUrl = await renderThumbnail(buffer, ext, canvas, color);

      if (dataUrl) {
        window.polytray.sendThumbnailResult({
          filePath,
          thumbPath,
          success: true,
          dataUrl,
        });
      } else {
        window.polytray.sendThumbnailResult({
          filePath,
          thumbPath,
          success: false,
        });
      }
    } catch (e) {
      console.warn("Thumbnail generation failed for", filePath, e);
      window.polytray.sendThumbnailResult({
        filePath,
        thumbPath,
        success: false,
      });
    }
  });

  const previewCleanup = window.polytray.onPreviewParseRequest(async (data) => {
    const { filePath, ext } = data;
    const totalStartedAt = performance.now();

    try {
      const fetchStartedAt = performance.now();
      const buffer = await readPreviewBuffer(filePath);
      const fetchDurationMs = performance.now() - fetchStartedAt;

      const {
        meshes,
        transferables,
        parseDurationMs,
        serializeDurationMs,
      } = await parsePreviewMeshes(buffer, ext);
      const payloadBytes = transferables.reduce(
        (total, transferable) => total + transferable.byteLength,
        0,
      );
      const totalDurationMs = performance.now() - totalStartedAt;

      window.polytray.emitPreviewMetric({
        source: "hidden-renderer",
        phase: "fetch",
        filePath,
        ext,
        durationMs: fetchDurationMs,
      });
      window.polytray.emitPreviewMetric({
        source: "hidden-renderer",
        phase: "parse",
        filePath,
        ext,
        durationMs: parseDurationMs,
        meshCount: meshes.length,
      });
      window.polytray.emitPreviewMetric({
        source: "hidden-renderer",
        phase: "serialize",
        filePath,
        ext,
        durationMs: serializeDurationMs,
        meshCount: meshes.length,
        payloadBytes,
      });
      window.polytray.emitPreviewMetric({
        source: "hidden-renderer",
        phase: "background-total",
        filePath,
        ext,
        durationMs: totalDurationMs,
        meshCount: meshes.length,
        payloadBytes,
      });

      window.postMessage(
        {
          type: "__polytray-preview-parse-result",
          requestId: data.requestId,
          meshes,
        },
        "*",
        transferables,
      );
    } catch (e) {
      console.warn("Preview parse failed for", filePath, e);
      window.postMessage(
        {
          type: "__polytray-preview-parse-error",
          requestId: data.requestId,
          error: e instanceof Error ? e.message : String(e),
        },
        "*",
      );
    }
  });

  return () => {
    cleanup();
    previewCleanup();
  };
}
