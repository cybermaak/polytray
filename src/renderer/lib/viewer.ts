/**
 * viewer.ts — Core 3D viewer lifecycle.
 *
 * Manages the interactive Three.js viewer: scene setup, model loading,
 * animation loop, multi-model carousel, wireframe toggle, and cleanup.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VIEWER_CONFIG } from "./viewerConfig";
import { setModelColor, createMaterial } from "./modelParsers";
import { computeCameraFit } from "./cameraUtils";
import { PartThumbnailQueue } from "./partThumbnailQueue";
import type { SerializedMesh } from "../../shared/types";
import { loadPreviewMeshes } from "./previewStrategies";
import { assembleSerializedMeshes, disposeAssemblyGroup } from "./meshAssembly";
import {
  createMainWindowVisibilityGate,
  disposeOwnedViewerResources,
  ViewerSession,
} from "./viewerSession";

// ── Re-exports for backward compatibility ─────────────────────────
export { VIEWER_CONFIG } from "./viewerConfig";

// ── Viewer State ──────────────────────────────────────────────────

interface ViewerState {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: OrbitControls | null;
  currentModel: THREE.Object3D | null;
  debugModel: THREE.Object3D | null;
  gridHelper: THREE.GridHelper | null;
  wireframeMode: boolean;
  multiModelMeshes: THREE.Object3D[];
  activeSubModelIndex: number;
  container: HTMLElement | null;
  multiModelContainer: HTMLElement | null;
  partThumbnailRenderer: THREE.WebGLRenderer | null;
  partThumbnailScene: THREE.Scene | null;
  partThumbnailCamera: THREE.PerspectiveCamera | null;
  partThumbnailQueue: PartThumbnailQueue<THREE.Object3D> | null;
  partThumbnailParts: Array<{ id: string; label: string; object: THREE.Object3D }>;
  partThumbnailToken: number;
}

function createInitialState(): ViewerState {
  return {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    currentModel: null,
    debugModel: null,
    gridHelper: null,
    wireframeMode: false,
    multiModelMeshes: [],
    activeSubModelIndex: -1,
    container: null,
    multiModelContainer: null,
    partThumbnailRenderer: null,
    partThumbnailScene: null,
    partThumbnailCamera: null,
    partThumbnailQueue: null,
    partThumbnailParts: [],
    partThumbnailToken: -1,
  };
}

let state: ViewerState = createInitialState();
let activeSession: ViewerSession<ViewerState> | null = null;
let pendingFirstRenderMetric: {
  filePath: string;
  ext: string;
  startedAt: number;
  meshCount: number;
  owner: ViewerSession<ViewerState>;
  loadToken: number;
} | null = null;
let lastRenderedLoad: { owner: ViewerSession<ViewerState>; loadToken: number } | null = null;
let firstFrameWaiter: { owner: ViewerSession<ViewerState>; loadToken: number; finish: (rendered: boolean) => void } | null = null;
const PREVIEW_COLOR_PATTERN = /^#[\da-f]{6}$/i;

function seedViewerModelColor(containerEl: HTMLElement) {
  const configuredColor = window.getComputedStyle(containerEl)
    .getPropertyValue("--preview-model-color")
    .trim();
  const fallbackColor = `#${VIEWER_CONFIG.material.color.toString(16).padStart(6, "0")}`;
  setModelColor(PREVIEW_COLOR_PATTERN.test(configuredColor) ? configuredColor : fallbackColor);
}

function getMultiModelContainer() {
  if (!state.multiModelContainer) {
    state.multiModelContainer = document.getElementById("viewer-multi-model");
  }
  return state.multiModelContainer;
}

function installSessionListeners(session: ViewerSession<ViewerState>) {
  const colorHandler = (event: Event) => {
    if (activeSession !== session) return;
    const hex = (event as CustomEvent).detail;
    setModelColor(hex);
    const newColor = new THREE.Color(hex);
    const recolor = (child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh && child.material && child.material.color) {
        child.material.color.copy(newColor);
      }
    };
    state.currentModel?.traverse(recolor);
    state.multiModelMeshes.forEach((mesh) => mesh.traverse(recolor));
    session.invalidate();
  };
  let nativeWindowVisible = true;
  const synchronizeVisibility = () => {
    session.setVisible(nativeWindowVisible && document.visibilityState === "visible");
  };
  const acceptNativeVisibility = createMainWindowVisibilityGate((visible) => {
    if (activeSession !== session || session.isDisposed) return;
    nativeWindowVisible = visible;
    synchronizeVisibility();
  });
  const unsubscribeNativeVisibility = window.polytray.onMainWindowVisibility(acceptNativeVisibility);
  session.addCleanup(unsubscribeNativeVisibility);
  void window.polytray.getMainWindowVisibility().then(acceptNativeVisibility).catch((error) => {
    if (!session.isDisposed) console.warn("Could not read main window visibility", error);
  });
  const visibilityHandler = synchronizeVisibility;
  window.addEventListener("polytray-preview-color", colorHandler);
  document.addEventListener("visibilitychange", visibilityHandler);
  session.addCleanup(() => window.removeEventListener("polytray-preview-color", colorHandler));
  session.addCleanup(() => document.removeEventListener("visibilitychange", visibilityHandler));
  synchronizeVisibility();
}

// ── Initialization ────────────────────────────────────────────────

export function initViewer(containerEl: HTMLElement) {
  disposeViewer();
  state = createInitialState();
  state.container = containerEl;
  seedViewerModelColor(containerEl);

  const width = state.container.clientWidth;
  const height = state.container.clientHeight;

  // Scene
  state.scene = new THREE.Scene();

  // Camera
  const { fov, near, far } = VIEWER_CONFIG.camera;
  state.camera = new THREE.PerspectiveCamera(fov, width / height, near, far);
  state.camera.position.set(3, 2, 3);

  // Renderer
  state.renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  state.renderer.setSize(width, height);
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = VIEWER_CONFIG.exposure;
  state.renderer.shadowMap.enabled = false;
  state.container.appendChild(state.renderer.domElement);

  // Controls
  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = VIEWER_CONFIG.controls.dampingFactor;
  state.controls.rotateSpeed = VIEWER_CONFIG.controls.rotateSpeed;
  state.controls.zoomSpeed = VIEWER_CONFIG.controls.zoomSpeed;
  state.controls.panSpeed = VIEWER_CONFIG.controls.panSpeed;
  state.controls.minDistance = VIEWER_CONFIG.controls.minDistance;
  state.controls.maxDistance = VIEWER_CONFIG.controls.maxDistance;

  // Lighting
  setupLighting();

  // Grid
  setupGrid();

  const resources = state;
  const session = new ViewerSession(resources, {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (frameId) => cancelAnimationFrame(frameId),
    updateControls: () => resources.controls?.update() ?? false,
    draw: () => {
      const { renderer, scene, camera } = resources;
      if (!renderer || !scene || !camera) return;
      let firstRender = pendingFirstRenderMetric;
      if (firstRender && (!firstRender.owner.isCurrent(firstRender.loadToken) || activeSession !== firstRender.owner)) {
        pendingFirstRenderMetric = null;
        firstRender = null;
      }
      const renderStartedAt = performance.now();
      renderer.render(scene, camera);
      if (firstRender) {
        lastRenderedLoad = { owner: firstRender.owner, loadToken: firstRender.loadToken };
        pendingFirstRenderMetric = null;
        const renderedAt = performance.now();
        performance.measure("polytray-preview-first-render", {
          start: firstRender.startedAt,
          end: renderedAt,
        });
        performance.measure("polytray-preview-render-submit", {
          start: renderStartedAt,
          end: renderedAt,
        });
        window.polytray.emitPreviewMetric({
          source: "viewer",
          phase: "first-render",
          filePath: firstRender.filePath,
          ext: firstRender.ext,
          durationMs: renderedAt - firstRender.startedAt,
          meshCount: firstRender.meshCount,
          renderSubmitMs: renderedAt - renderStartedAt,
        });
        if (firstFrameWaiter?.owner === firstRender.owner && firstFrameWaiter.loadToken === firstRender.loadToken) {
          firstFrameWaiter.finish(true);
        }
      }
      const probeWindow = window as Window & {
        __POLYTRAY_RENDERER_PROBE?: {
          markViewerFrame?: () => void;
          markViewerDrawCalls?: (count: number) => void;
        };
      };
      probeWindow.__POLYTRAY_RENDERER_PROBE?.markViewerFrame?.();
      probeWindow.__POLYTRAY_RENDERER_PROBE?.markViewerDrawCalls?.(renderer.info.render.calls);
    },
  }, (ownedResources, owner) => disposeOwnedViewerResources(
    owner,
    activeSession,
    ownedResources,
    disposeViewerResources,
    () => {
      activeSession = null;
      if (state === ownedResources) state = createInitialState();
    },
  ));
  activeSession = session;
  installSessionListeners(session);

  // Handle resize
  window.addEventListener("resize", handleResize);
  session.addCleanup(() => window.removeEventListener("resize", handleResize));
  const controls = state.controls;
  const controlsChange = () => session.invalidate();
  controls.addEventListener("change", controlsChange);
  session.addCleanup(() => controls.removeEventListener("change", controlsChange));
  session.invalidate();
  return session;
}

function setupLighting() {
  const L = VIEWER_CONFIG.lighting;

  const ambient = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity);
  state.scene!.add(ambient);

  const hemi = new THREE.HemisphereLight(
    L.hemisphere.skyColor,
    L.hemisphere.groundColor,
    L.hemisphere.intensity,
  );
  state.scene!.add(hemi);

  const dirLight = new THREE.DirectionalLight(L.key.color, L.key.intensity);
  dirLight.position.set(...L.key.position);
  state.camera!.add(dirLight);

  const fillLight = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
  fillLight.position.set(...L.fill.position);
  state.camera!.add(fillLight);

  const rimLight = new THREE.DirectionalLight(L.rim.color, L.rim.intensity);
  rimLight.position.set(...L.rim.position);
  state.camera!.add(rimLight);

  state.scene!.add(state.camera!);
}

function setupGrid() {
  const G = VIEWER_CONFIG.grid;
  state.gridHelper = new THREE.GridHelper(
    G.size,
    G.divisions,
    G.centerColor,
    G.lineColor,
  );
  (state.gridHelper.material as THREE.Material).opacity = G.opacity;
  (state.gridHelper.material as THREE.Material).transparent = true;
  state.scene!.add(state.gridHelper);
}

export function toggleGrid(visible: boolean) {
  if (state.gridHelper) {
    state.gridHelper.visible = visible;
    activeSession?.invalidate();
  }
}

function handleResize() {
  if (!state.container || !state.camera || !state.renderer) return;
  const width = state.container.clientWidth;
  const height = state.container.clientHeight;
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height);
  activeSession?.invalidate();
}

export function notifyViewerResize() {
  handleResize();
}

// ── Model Loading ─────────────────────────────────────────────────

/**
 * Modern non-blocking loader using Web Workers and AbortSignal.
 */
export async function loadModelWithWorker(
  fileUrl: string,
  extension: string,
  fileName: string,
  contentRevision: number,
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
) {
  const session = activeSession;
  if (!session) throw new Error("Viewer is not initialized");
  firstFrameWaiter?.finish(false);
  const loadToken = session.beginLoad();
  lastRenderedLoad = null;
  resetPartThumbnailWork(loadToken);
  pendingFirstRenderMetric = null;
  const backgroundStartedAt = performance.now();
  const prepared = await loadPreviewMeshes({
    fileUrl,
    extension,
    contentRevision,
    signal,
    onProgress,
  });
  if (!session.isCurrent(loadToken) || signal.aborted) return;
  const backgroundWaitMs = performance.now() - backgroundStartedAt;

  if (prepared.preparationDurationMs !== undefined) {
    window.polytray.emitPreviewMetric({
      source: "viewer",
      phase: "prepare",
      filePath: fileUrl,
      ext: extension,
      durationMs: prepared.preparationDurationMs,
      meshCount: prepared.meshes.length,
    });
  }

  window.polytray.emitPreviewMetric({
    source: "viewer",
    phase: "background-wait",
    filePath: fileUrl,
    ext: extension,
    durationMs: backgroundWaitMs,
    meshCount: prepared.meshes.length,
  });

  const buildStartedAt = performance.now();
  await buildModelFromMeshes(prepared.meshes, fileName, signal, session, loadToken, prepared.bounds, {
    filePath: fileUrl,
    extension,
    startedAt: backgroundStartedAt,
  });
  if (!session.isCurrent(loadToken) || signal.aborted) return;
  if (!(await waitForUsableFrame(session, loadToken, signal))) return;
  if (!session.isCurrent(loadToken) || signal.aborted) return;
  const buildDurationMs = performance.now() - buildStartedAt;

  window.polytray.emitPreviewMetric({
    source: "viewer",
    phase: "build",
    filePath: fileUrl,
    ext: extension,
    durationMs: buildDurationMs,
    meshCount: prepared.meshes.length,
  });
  window.polytray.emitPreviewMetric({
    source: "viewer",
    phase: "preview-total",
    filePath: fileUrl,
    ext: extension,
    durationMs: backgroundWaitMs + buildDurationMs,
    meshCount: prepared.meshes.length,
  });
}

function waitForUsableFrame(session: ViewerSession<ViewerState>, loadToken: number, signal: AbortSignal) {
  if (signal.aborted || !session.isCurrent(loadToken)) return Promise.resolve(false);
  if (lastRenderedLoad?.owner === session && lastRenderedLoad.loadToken === loadToken) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let removeSessionCleanup = () => {};
    const finish = (rendered: boolean) => {
      if (firstFrameWaiter?.finish !== finish) return;
      firstFrameWaiter = null;
      signal.removeEventListener("abort", onAbort);
      removeSessionCleanup();
      resolve(rendered);
    };
    const onAbort = () => finish(false);
    removeSessionCleanup = session.addCleanup(() => finish(false));
    firstFrameWaiter = { owner: session, loadToken, finish };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

// ── Multi-Model Thumbnail Strip ───────────────────────────────────

async function updateMultiModelThumbnailStrip(
  group: THREE.Group,
  session: ViewerSession<ViewerState>,
  loadToken: number,
  signal: AbortSignal,
) {
  if (signal.aborted || !session.isCurrent(loadToken)) return;
  state.multiModelMeshes = [];
  state.activeSubModelIndex = -1;
  state.partThumbnailParts = [];
  window.dispatchEvent(new CustomEvent("polytray-multipart-clear"));

  // Only extract sub-meshes if it's actually complicated (like 3MF splits)
  // We collect direct Mesh children or Group children that contain Meshes
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
      // Find how many actual triangles this child has before counting it as a valid "sub model"
      let hasGeometry = false;
      child.traverse((n) => {
        if (n instanceof THREE.Mesh && n.geometry) hasGeometry = true;
      });
      if (hasGeometry) state.multiModelMeshes.push(child);
    }
  }

  // If there's only 1 thing, no need for a carousel
  if (state.multiModelMeshes.length < 2) return;

  state.partThumbnailToken = loadToken;
  state.partThumbnailParts = state.multiModelMeshes.map((object, index) => ({
    id: `part-${loadToken}-${index}`,
    label: object.name || `Part ${index + 1}`,
    object,
  }));
  window.dispatchEvent(new CustomEvent("polytray-multipart-parts", {
    detail: state.partThumbnailParts.map(({ id, label }) => ({ id, label })),
  }));
}

function resetPartThumbnailWork(loadToken: number) {
  disposePartThumbnailResources();
  state.partThumbnailToken = loadToken;
  state.partThumbnailParts = [];
  window.dispatchEvent(new CustomEvent("polytray-multipart-clear"));
}

function ensurePartThumbnailRenderer(session: ViewerSession<ViewerState>) {
  if (state.partThumbnailQueue && state.partThumbnailRenderer && state.partThumbnailScene && state.partThumbnailCamera) return;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(128, 128);
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(3, 5, 4);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  state.partThumbnailRenderer = renderer;
  state.partThumbnailScene = scene;
  state.partThumbnailCamera = camera;
  const queue = new PartThumbnailQueue<THREE.Object3D>({
    maxCache: 64,
    render: (object, signal) => renderPartThumbnail(object, signal),
    yieldControl: () => session.yieldToFrame(),
    release: (url) => URL.revokeObjectURL(url),
  });
  queue.replace(state.partThumbnailToken);
  state.partThumbnailQueue = queue;
  reportPartThumbnailResources(session.resources, true);
}

function disposePartThumbnailResources(resources: ViewerState = state) {
  resources.partThumbnailQueue?.dispose();
  resources.partThumbnailQueue = null;
  if (resources.partThumbnailRenderer) {
    resources.partThumbnailRenderer.dispose();
    resources.partThumbnailRenderer.forceContextLoss();
  }
  resources.partThumbnailRenderer = null;
  resources.partThumbnailScene = null;
  resources.partThumbnailCamera = null;
  resources.partThumbnailParts = [];
  reportPartThumbnailResources(resources, false);
}

function reportPartThumbnailResources(resources: ViewerState, active: boolean) {
  const owner = activeSession?.resources === resources ? activeSession : null;
  const probeWindow = window as Window & {
    __POLYTRAY_RENDERER_PROBE?: {
      markPartThumbnailLifecycle?: (rendererActive: boolean, cameraActive: boolean, cleanupCount: number) => void;
    };
  };
  probeWindow.__POLYTRAY_RENDERER_PROBE?.markPartThumbnailLifecycle?.(active, active, owner?.cleanupCount ?? 0);
}

async function renderPartThumbnail(object: THREE.Object3D, signal: AbortSignal): Promise<string> {
  let renderer = state.partThumbnailRenderer;
  let scene = state.partThumbnailScene;
  let camera = state.partThumbnailCamera;
  if (!renderer || !scene || !camera || signal.aborted) throw new Error("Thumbnail renderer unavailable");
  let clone: THREE.Object3D | null = object.clone(true);
  scene.add(clone);
  try {
    const { center, maxDim } = computeCameraFit(clone, camera);
    camera.position.multiplyScalar(1.15);
    camera.lookAt(center);
    camera.near = Math.max(0.001, maxDim / 1000);
    camera.far = Math.max(100, maxDim * 20);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    if (signal.aborted) throw new Error("Thumbnail cancelled");
    const canvas = renderer.domElement;
    scene.remove(clone);
    clone = null;
    renderer = null;
    scene = null;
    camera = null;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("Thumbnail image encoding failed")), "image/png"));
    if (signal.aborted) throw new Error("Thumbnail cancelled");
    return URL.createObjectURL(blob);
  } finally {
    if (clone && scene) scene.remove(clone);
  }
}

export function requestPartThumbnail(id: string) {
  const session = activeSession;
  const token = state.partThumbnailToken;
  const part = state.partThumbnailParts.find((item) => item.id === id);
  if (!session || !part || !session.isCurrent(token)) return;
  ensurePartThumbnailRenderer(session);
  state.partThumbnailQueue?.request(token, [{ key: id, value: part.object }],
    () => activeSession === session && session.isCurrent(token),
    (key, url, acknowledgeRelease, releasedUrl) => window.dispatchEvent(new CustomEvent("polytray-part-thumbnail", {
      detail: { id: key, url, acknowledgeRelease, releasedUrl },
    })));
}

export function selectViewerPart(index: number) {
  if (!state.currentModel || (index >= state.multiModelMeshes.length)) return;
  state.activeSubModelIndex = index;

  if (index === -1) {
    // Show all
    state.multiModelMeshes.forEach((m) => (m.visible = true));
    fitCameraToObject(state.currentModel!);
  } else {
    // Show specifically the one clicked
    state.multiModelMeshes.forEach((m, idx) => {
      m.visible = idx === index;
    });
    fitCameraToObject(state.multiModelMeshes[index]);
  }
  window.dispatchEvent(new CustomEvent("polytray-part-selection", { detail: index }));
  activeSession?.invalidate();
}

// ── Camera Operations ─────────────────────────────────────────────

function fitCameraToObject(object: THREE.Object3D) {
  const { center, maxDim } = computeCameraFit(object, state.camera!);

  state.controls!.target.copy(center);
  state.controls!.minDistance = maxDim * 0.1;
  state.controls!.maxDistance = maxDim * 10;
  state.controls!.update();

  state.camera!.updateProjectionMatrix();
  activeSession?.invalidate();
}

export function resetCamera() {
  if (state.currentModel) {
    fitCameraToObject(state.currentModel);
    activeSession?.invalidate();
  }
}

// ── Wireframe Toggle ──────────────────────────────────────────────

export function toggleWireframe() {
  state.wireframeMode = !state.wireframeMode;
  if (state.currentModel) {
    state.currentModel.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        child.material.wireframe = state.wireframeMode;
      }
    });
  }
  activeSession?.invalidate();
}

// ── Cleanup ───────────────────────────────────────────────────────

export function disposeViewer() {
  pendingFirstRenderMetric = null;
  const session = activeSession;
  if (session) {
    session.dispose();
    return;
  }

  disposeViewerResources(state, true);
  state = createInitialState();
}

export async function buildModelFromMeshes(
  meshes: SerializedMesh[],
  name: string,
  signal: AbortSignal,
  owner = activeSession,
  requestedToken?: number,
  preparedBounds?: { min: [number, number, number]; max: [number, number, number] },
  metricContext?: { filePath: string; extension: string; startedAt: number },
) {
  if (!owner || owner.isDisposed || activeSession !== owner) return;
  const loadToken = requestedToken ?? owner.beginLoad();
  const group = await assembleSerializedMeshes(meshes, {
    signal,
    isCurrent: () => owner.isCurrent(loadToken) && activeSession === owner,
    yieldToFrame: () => owner.yieldToFrame(signal),
    createMaterial,
  });
  if (!group) return;
  if (signal.aborted || !owner.isCurrent(loadToken) || activeSession !== owner) {
    disposeAssemblyGroup(group);
    return;
  }
  group.name = name;

  if (signal.aborted || !owner.isCurrent(loadToken) || activeSession !== owner) { disposeAssemblyGroup(group); return; }

  const scaledBox = preparedBounds
    ? new THREE.Box3(new THREE.Vector3(...preparedBounds.min), new THREE.Vector3(...preparedBounds.max))
    : new THREE.Box3().setFromObject(group);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
  if (maxDim > 0) {
    const scale = VIEWER_CONFIG.normalizeScale / maxDim;
    group.scale.set(scale, scale, scale);
  }

  const finalCenter = scaledBox.getCenter(new THREE.Vector3());
  group.position.x = -finalCenter.x * group.scale.x;
  group.position.y = -scaledBox.min.y * group.scale.y;
  group.position.z = -finalCenter.z * group.scale.z;

  if (signal.aborted || !owner.isCurrent(loadToken) || activeSession !== owner) {
    disposeAssemblyGroup(group);
    return;
  }
  if (state.currentModel) {
    state.scene!.remove(state.currentModel);
    clearCurrentModelDiagnostic(state);
    disposeObject(state.currentModel);
    state.currentModel = null;
  }

  state.scene!.add(group);
  state.currentModel = group;
  if (metricContext) {
    pendingFirstRenderMetric = {
      ...metricContext,
      ext: metricContext.extension.toLowerCase(),
      meshCount: meshes.length,
      owner,
      loadToken,
    };
  }
  owner.invalidate();

  await updateMultiModelThumbnailStrip(group, owner, loadToken, signal);
  if (signal.aborted || !owner.isCurrent(loadToken) || activeSession !== owner) return;

  if (typeof window !== "undefined") {
    publishCurrentModelDiagnostic(state);
  }

  fitCameraToObject(group);
  state.wireframeMode = false;
  owner.invalidate();
}

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

function clearCurrentModelDiagnostic(resources: ViewerState) {
  if (typeof window !== "undefined") {
    const diagnosticWindow = window as Window & { __POLYTRAY_CURRENT_MODEL?: THREE.Object3D | null };
    if (resources.debugModel && diagnosticWindow.__POLYTRAY_CURRENT_MODEL === resources.debugModel) {
      diagnosticWindow.__POLYTRAY_CURRENT_MODEL = null;
    }
  }
  resources.debugModel = null;
}

function publishCurrentModelDiagnostic(resources: ViewerState) {
  resources.debugModel = resources.currentModel;
  if (typeof window !== "undefined") {
    (window as Window & { __POLYTRAY_CURRENT_MODEL?: THREE.Object3D | null }).__POLYTRAY_CURRENT_MODEL = resources.debugModel;
  }
}

function disposeViewerResources(resources: ViewerState, ownsCurrentUi: boolean) {
  disposePartThumbnailResources(resources);
  if (resources.currentModel) {
    resources.scene?.remove(resources.currentModel);
    clearCurrentModelDiagnostic(resources);
    disposeObject(resources.currentModel);
    resources.currentModel = null;
  } else {
    clearCurrentModelDiagnostic(resources);
  }

  if (resources.gridHelper) {
    resources.scene?.remove(resources.gridHelper);
    resources.gridHelper.geometry.dispose();
    const materials = Array.isArray(resources.gridHelper.material)
      ? resources.gridHelper.material
      : [resources.gridHelper.material];
    materials.forEach((material) => material.dispose());
    resources.gridHelper = null;
  }

  if (ownsCurrentUi) {
    window.dispatchEvent(new CustomEvent("polytray-multipart-clear"));
    const multiModelContainer = resources.multiModelContainer ?? document.getElementById("viewer-multi-model");
    multiModelContainer?.replaceChildren();
    multiModelContainer?.classList.add("hidden");
  }

  resources.controls?.dispose();
  resources.controls = null;
  if (resources.renderer) {
    resources.renderer.dispose();
    resources.renderer.forceContextLoss();
    resources.renderer.domElement.parentNode?.removeChild(resources.renderer.domElement);
    resources.renderer = null;
  }

  resources.scene = null;
  resources.camera = null;
  resources.multiModelMeshes = [];
  resources.activeSubModelIndex = -1;
  resources.multiModelContainer = null;
  resources.container = null;
}
