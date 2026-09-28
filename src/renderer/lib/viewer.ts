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
import type { SerializedMesh } from "../../shared/types";
import { loadPreviewMeshes } from "./previewStrategies";
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
const BUILD_TIME_BUDGET_MS = 8;
const BUILD_VERTEX_BUDGET = 100_000;
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
    preserveDrawingBuffer: true, // Needed for capturing sub-model thumbnails
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
  const loadToken = session.beginLoad();
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
  await buildModelFromMeshes(prepared.meshes, fileName, session, loadToken, prepared.bounds, {
    filePath: fileUrl,
    extension,
    startedAt: backgroundStartedAt,
  });
  if (!session.isCurrent(loadToken)) return;
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

// ── Multi-Model Thumbnail Strip ───────────────────────────────────

async function updateMultiModelThumbnailStrip(
  group: THREE.Group,
  session: ViewerSession<ViewerState>,
  loadToken: number,
) {
  if (!session.isCurrent(loadToken)) return;
  const multiModelContainer = getMultiModelContainer();
  if (!multiModelContainer) return;

  state.multiModelMeshes = [];
  state.activeSubModelIndex = -1;
  multiModelContainer.innerHTML = "";
  multiModelContainer.classList.add("hidden");

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

  // We have multiple distinct models! Let's build a thumbnail strip.
  multiModelContainer.classList.remove("hidden");

  // Wait a frame so the UI flexbox can settle before generating thumbs
  await new Promise((r) => setTimeout(r, 10));
  if (!session.isCurrent(loadToken)) return;

  for (let i = 0; i < state.multiModelMeshes.length; i++) {
    if (i > 0 && i % 2 === 0) {
      await session.yieldToFrame();
      if (!session.isCurrent(loadToken)) return;
    }

    const sub = state.multiModelMeshes[i];

    // Hide everything else temporarily to take a picture
    state.multiModelMeshes.forEach((m, idx) => {
      m.visible = idx === i;
    });

    // Render snapshot
    fitCameraToObject(sub); // zoom camera tight on this specific sub-model
    state.renderer!.render(state.scene!, state.camera!);

    const thumbDiv = document.createElement("div");
    thumbDiv.className = "multi-model-thumb";

    // We can just grab the data-url right out of our main WebGL canvas since it was preserved!
    const img = document.createElement("img");
    img.src = state.renderer!.domElement.toDataURL("image/png");

    thumbDiv.appendChild(img);
    thumbDiv.onclick = () => selectSubModel(i, thumbDiv);
    multiModelContainer.appendChild(thumbDiv);
  }

  // Add a "Show All" button at the start
  const showAllDiv = document.createElement("div");
  showAllDiv.className = "multi-model-thumb active";
  showAllDiv.style.flexDirection = "column";
  showAllDiv.style.fontSize = "10px";
  showAllDiv.style.fontWeight = "bold";
  showAllDiv.style.color = "var(--text-secondary)";
  showAllDiv.innerHTML = "Show<br/>All";
  showAllDiv.onclick = () => selectSubModel(-1, showAllDiv);
  multiModelContainer.insertBefore(showAllDiv, multiModelContainer.firstChild);

  // Restore visibility to ALL objects to start
  state.multiModelMeshes.forEach((m) => (m.visible = true));
  fitCameraToObject(group); // Refit the main camera back to the whole group
  session.invalidate();
}

function selectSubModel(index: number, htmlElement: HTMLElement) {
  // Update UI active state
  const mc = getMultiModelContainer();
  if (mc) {
    const thumbs = mc.querySelectorAll(".multi-model-thumb");
    thumbs.forEach((el) => el.classList.remove("active"));
  }
  htmlElement.classList.add("active");

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
  owner = activeSession,
  requestedToken?: number,
  preparedBounds?: { min: [number, number, number]; max: [number, number, number] },
  metricContext?: { filePath: string; extension: string; startedAt: number },
) {
  if (!owner || owner.isDisposed || activeSession !== owner) return;
  const loadToken = requestedToken ?? owner.beginLoad();
  const group = new THREE.Group();
  group.name = name;
  let pendingVertices = 0;
  let sliceStartedAt = performance.now();

  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const geometry = new THREE.BufferGeometry();
    for (const [attrName, attrData] of Object.entries(m.geometry.attributes)) {
      const { array, itemSize, normalized } = attrData;
      geometry.setAttribute(attrName, new THREE.BufferAttribute(array, itemSize, normalized));
    }
    if (m.geometry.index) {
      if (m.geometry.index.array instanceof Uint16Array) {
        geometry.setIndex(new THREE.Uint16BufferAttribute(m.geometry.index.array, 1));
      } else {
        geometry.setIndex(new THREE.Uint32BufferAttribute(m.geometry.index.array, 1));
      }
    }

    if (!geometry.getAttribute("normal")) {
      geometry.dispose();
      disposeObject(group);
      throw new Error("Prepared preview geometry is missing normals");
    }

    const mesh = new THREE.Mesh(geometry, createMaterial());
    mesh.name = m.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    pendingVertices += geometry.getAttribute("position")?.count ?? 0;
    if (performance.now() - sliceStartedAt >= BUILD_TIME_BUDGET_MS || pendingVertices >= BUILD_VERTEX_BUDGET) {
      await owner.yieldToFrame();
      if (!owner.isCurrent(loadToken) || activeSession !== owner) {
        disposeObject(group);
        return;
      }
      pendingVertices = 0;
      sliceStartedAt = performance.now();
    }
  }

  if (!owner.isCurrent(loadToken) || activeSession !== owner) {
    disposeObject(group);
    return;
  }

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

  if (!owner.isCurrent(loadToken) || activeSession !== owner) {
    disposeObject(group);
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

  await updateMultiModelThumbnailStrip(group, owner, loadToken);
  if (!owner.isCurrent(loadToken) || activeSession !== owner) return;

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
    const multiModelContainer = resources.multiModelContainer ?? document.getElementById("viewer-multi-model");
    multiModelContainer?.replaceChildren();
    multiModelContainer?.classList.add("hidden");
  }

  resources.controls?.dispose();
  resources.controls = null;
  if (resources.renderer) {
    resources.renderer.dispose();
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
