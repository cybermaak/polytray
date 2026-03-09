/**
 * viewer.ts — Core 3D viewer lifecycle.
 *
 * Manages the interactive Three.js viewer: scene setup, model loading,
 * animation loop, multi-model carousel, wireframe toggle, and cleanup.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VIEWER_CONFIG } from "./viewerConfig";
import { parseModelToGroup, setModelAccentColor, createMaterial } from "./modelParsers";
import { applySmartOrientation } from "./orientation";
import { computeCameraFit } from "./cameraUtils";
import ParserWorker from "./workers/parser.worker?worker";
import type { SerializedMesh } from "./workers/parser.worker";

// ── Re-exports for backward compatibility ─────────────────────────
export { VIEWER_CONFIG } from "./viewerConfig";

// ── Viewer State ──────────────────────────────────────────────────

interface ViewerState {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: OrbitControls | null;
  currentModel: THREE.Object3D | null;
  gridHelper: THREE.GridHelper | null;
  animationId: number | null;
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
    gridHelper: null,
    animationId: null,
    wireframeMode: false,
    multiModelMeshes: [],
    activeSubModelIndex: -1,
    container: null,
    multiModelContainer: null,
  };
}

const state: ViewerState = createInitialState();
let currentWorker: Worker | null = null;

function getMultiModelContainer() {
  if (!state.multiModelContainer) {
    state.multiModelContainer = document.getElementById("viewer-multi-model");
  }
  return state.multiModelContainer;
}

window.addEventListener("polytray-accent-color", (e: Event) => {
  const hex = (e as CustomEvent).detail;
  setModelAccentColor(hex);
  
  const newColor = new THREE.Color(hex);
  const reColor = (child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh && child.material && child.material.color) {
      child.material.color.copy(newColor);
    }
  };

  if (state.currentModel) {
    state.currentModel.traverse(reColor);
  }
  
  state.multiModelMeshes.forEach(mesh => mesh.traverse(reColor));
});

// ── Initialization ────────────────────────────────────────────────

export function initViewer(containerEl: HTMLElement) {
  state.container = containerEl;

  // Clean up any previous viewer
  disposeViewer();

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

  // Handle resize
  window.addEventListener("resize", handleResize);

  // Start render loop
  animate();
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
  }
}

function animate() {
  state.animationId = requestAnimationFrame(animate);
  if (state.controls) state.controls.update();
  if (state.renderer && state.scene && state.camera)
    state.renderer.render(state.scene, state.camera);
}

function handleResize() {
  if (!state.container || !state.camera || !state.renderer) return;
  const width = state.container.clientWidth;
  const height = state.container.clientHeight;
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height);
}

// ── Model Loading ─────────────────────────────────────────────────

export async function loadModelFromUrl(
  fileUrl: string,
  extension: string,
  fileName: string,
  onProgress?: (percent: number) => void,
) {
  const loadUrl = fileUrl.startsWith("polytray://local/")
    ? fileUrl
    : `polytray://local/${encodeURIComponent(fileUrl)}`;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", loadUrl, true);
    xhr.responseType = "arraybuffer";

    xhr.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      } else if (onProgress) {
        onProgress(-1); // Indeterminate or parsing phase
      }
    };

    xhr.onload = async () => {
      if (xhr.status === 200 || xhr.status === 0) {
        try {
          await loadModel(xhr.response, extension, fileName);
          resolve();
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`Failed to load ${loadUrl}: status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error loading model"));
    xhr.send();
  });
}

/**
 * Modern non-blocking loader using Web Workers and AbortSignal.
 */
export async function loadModelWithWorker(
  fileUrl: string,
  extension: string,
  fileName: string,
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
) {
  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }

  const loadUrl = fileUrl.startsWith("polytray://local/")
    ? fileUrl
    : `polytray://local/${encodeURIComponent(fileUrl)}`;

  // Phase 1: Fetch
  if (onProgress) onProgress(-1);
  const response = await fetch(loadUrl, { signal });
  if (!response.ok)
    throw new Error(`Failed to load ${loadUrl}: status ${response.status}`);
  const buffer = await response.arrayBuffer();

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  // Phase 2: Parse in Worker
  return new Promise<void>((resolve, reject) => {
    currentWorker = new ParserWorker();

    const cleanup = () => {
      if (currentWorker) {
        currentWorker.terminate();
        currentWorker = null;
      }
    };

    if (!currentWorker) return;

    currentWorker.onmessage = async (e) => {
      const worker = currentWorker;
      if (!worker || signal.aborted) {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      if (e.data.error) {
        cleanup();
        reject(new Error(e.data.error));
      } else if (e.data.meshes) {
        // Phase 3: Build in Three.js (back on main thread)
        try {
          await buildModelFromMeshes(e.data.meshes, fileName);
          if (worker === currentWorker) cleanup();
          resolve();
        } catch (err) {
          if (worker === currentWorker) cleanup();
          reject(err);
        }
      }
    };

    currentWorker.onerror = (err) => {
      cleanup();
      reject(err);
    };

    currentWorker.postMessage({ buffer, extension }, [buffer]);

    signal.addEventListener("abort", () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

export async function loadModel(
  arrayBuffer: ArrayBuffer,
  extension: string,
  name: string,
) {
  // Remove previous model
  if (state.currentModel) {
    state.scene!.remove(state.currentModel);
    disposeObject(state.currentModel);
    state.currentModel = null;
  }

  const group = await parseModelToGroup(arrayBuffer, extension);
  group.name = name;

  // Apply smart orientation heuristics
  applySmartOrientation(group);

  // Normalize scale so max dimension is 10 units relative to the standard plane grid
  const scaledBox = new THREE.Box3().setFromObject(group);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
  if (maxDim > 0) {
    const scale = VIEWER_CONFIG.normalizeScale / maxDim;
    group.scale.set(scale, scale, scale);
    group.updateMatrixWorld(true);
  }

  // Final recenter to bring the base of the model to the grid floor
  const finalBox = new THREE.Box3().setFromObject(group);
  const finalCenter = finalBox.getCenter(new THREE.Vector3());
  group.position.x -= finalCenter.x;
  group.position.y -= finalBox.min.y;
  group.position.z -= finalCenter.z;

  state.scene!.add(group);
  state.currentModel = group;

  // Render multi-model carousel if applicable
  await updateMultiModelThumbnailStrip(group);

  // Expose current model for E2E testing diagnostics
  if (typeof window !== "undefined") {
    (
      window as Window & { __POLYTRAY_CURRENT_MODEL?: THREE.Object3D | null }
    ).__POLYTRAY_CURRENT_MODEL = state.currentModel;
  }

  // Auto-fit camera
  fitCameraToObject(group);

  state.wireframeMode = false;
}

// ── Multi-Model Thumbnail Strip ───────────────────────────────────

async function updateMultiModelThumbnailStrip(group: THREE.Group) {
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

  // We need a temporary offscreen canvas for rendering mini-thumbnails
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 128; // high-res enough for 64px display
  tempCanvas.height = 128;

  // Wait a frame so the UI flexbox can settle before generating thumbs
  await new Promise((r) => setTimeout(r, 10));

  for (let i = 0; i < state.multiModelMeshes.length; i++) {
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
}

// ── Camera Operations ─────────────────────────────────────────────

function fitCameraToObject(object: THREE.Object3D) {
  const { center, maxDim } = computeCameraFit(object, state.camera!);

  state.controls!.target.copy(center);
  state.controls!.minDistance = maxDim * 0.1;
  state.controls!.maxDistance = maxDim * 10;
  state.controls!.update();

  state.camera!.updateProjectionMatrix();
}

export function resetCamera() {
  if (state.currentModel) {
    fitCameraToObject(state.currentModel);
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
}

// ── Cleanup ───────────────────────────────────────────────────────

export function disposeViewer() {
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
    state.animationId = null;
  }

  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }

  window.removeEventListener("resize", handleResize);

  if (state.currentModel) {
    disposeObject(state.currentModel);
    state.currentModel = null;
  }

  if (state.controls) {
    state.controls.dispose();
    state.controls = null;
  }

  if (state.renderer) {
    state.renderer.dispose();
    if (state.renderer.domElement && state.renderer.domElement.parentNode) {
      state.renderer.domElement.parentNode.removeChild(
        state.renderer.domElement,
      );
    }
    state.renderer = null;
  }

  state.scene = null;
  state.camera = null;
  state.multiModelMeshes = [];
  state.activeSubModelIndex = -1;
  state.multiModelContainer = null;
}

export async function buildModelFromMeshes(meshes: SerializedMesh[], name: string) {
  // Remove previous model
  if (state.currentModel) {
    state.scene!.remove(state.currentModel);
    disposeObject(state.currentModel);
    state.currentModel = null;
  }

  const group = new THREE.Group();
  group.name = name;

  for (const m of meshes) {
    const geometry = new THREE.BufferGeometry();
    for (const [attrName, attrData] of Object.entries(m.geometry.attributes)) {
      const { array, itemSize, normalized } = attrData;
      geometry.setAttribute(attrName, new THREE.BufferAttribute(array, itemSize, normalized));
    }
    if (m.geometry.index) {
      geometry.setIndex(new THREE.Uint32BufferAttribute(m.geometry.index.array, 1));
    }
    
    // normals
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, createMaterial());
    mesh.name = m.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Apply smart orientation heuristics
  applySmartOrientation(group);

  // Normalize scale
  const scaledBox = new THREE.Box3().setFromObject(group);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
  if (maxDim > 0) {
    const scale = VIEWER_CONFIG.normalizeScale / maxDim;
    group.scale.set(scale, scale, scale);
    group.updateMatrixWorld(true);
  }

  // Recenters base to floor
  const finalBox = new THREE.Box3().setFromObject(group);
  const finalCenter = finalBox.getCenter(new THREE.Vector3());
  group.position.x -= finalCenter.x;
  group.position.y -= finalBox.min.y;
  group.position.z -= finalCenter.z;

  state.scene!.add(group);
  state.currentModel = group;

  await updateMultiModelThumbnailStrip(group);

  if (typeof window !== "undefined") {
    (window as Window & { __POLYTRAY_CURRENT_MODEL?: THREE.Object3D | null }).__POLYTRAY_CURRENT_MODEL = state.currentModel;
  }

  fitCameraToObject(group);
  state.wireframeMode = false;
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
