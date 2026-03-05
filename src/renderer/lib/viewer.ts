import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { fix3MF } from "./threemf-repair";

// ── Configuration Constants ───────────────────────────────────────
export const VIEWER_CONFIG = {
  camera: { fov: 45, near: 0.1, far: 10000, padding: 1.2 },
  exposure: 1.2,
  material: { color: 0x8888aa, metalness: 0.15, roughness: 0.6 },
  grid: {
    size: 20,
    divisions: 40,
    centerColor: 0x8a8b94,
    lineColor: 0x5c5d66,
    opacity: 0.4,
  },
  normalizeScale: 10.0,
  thumbnail: { size: 256 },
  lighting: {
    ambient: { color: 0x404050, intensity: 0.6 },
    hemisphere: { skyColor: 0x8888cc, groundColor: 0x443322, intensity: 0.5 },
    key: { color: 0xffffff, intensity: 1.2, position: [5, 8, 5] as const },
    fill: { color: 0x3b82f6, intensity: 0.4, position: [-3, 2, -3] as const },
    rim: { color: 0x3b82f6, intensity: 0.3, position: [0, -2, -5] as const },
  },
  thumbnailLighting: {
    ambient: { color: 0xffffff, intensity: 0.8 },
    hemisphere: { skyColor: 0xffffff, groundColor: 0x444444, intensity: 0.6 },
    key: { color: 0xffffff, intensity: 2.0, position: [5, 5, 5] as const },
    fill: { color: 0xffffff, intensity: 0.4, position: [-5, 0, -5] as const },
    rim: { color: 0xffffff, intensity: 0.6, position: [0, 5, -5] as const },
  },
  controls: {
    dampingFactor: 0.08,
    rotateSpeed: 0.8,
    zoomSpeed: 1.2,
    panSpeed: 0.8,
    minDistance: 0.1,
    maxDistance: 1000,
  },
} as const;

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

function getMultiModelContainer() {
  if (!state.multiModelContainer) {
    state.multiModelContainer = document.getElementById("viewer-multi-model");
  }
  return state.multiModelContainer;
}

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

function applySmartOrientation(meshOrGroup: THREE.Object3D) {
  let totalArea = 0;
  const normalAreas = new Map();
  const coa = new THREE.Vector3();

  meshOrGroup.updateMatrixWorld(true);

  meshOrGroup.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const pos = child.geometry.attributes.position;
      const index = child.geometry.index;
      if (!pos) return;

      const matrixWorld = child.matrixWorld;

      const va = new THREE.Vector3();
      const vb = new THREE.Vector3();
      const vc = new THREE.Vector3();
      const cb = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const triCenter = new THREE.Vector3();

      function addTriangle(a: number, b: number, c: number) {
        va.fromBufferAttribute(pos, a).applyMatrix4(matrixWorld);
        vb.fromBufferAttribute(pos, b).applyMatrix4(matrixWorld);
        vc.fromBufferAttribute(pos, c).applyMatrix4(matrixWorld);

        cb.subVectors(vc, vb);
        ab.subVectors(va, vb);
        cb.cross(ab);

        const area = cb.length() / 2;
        if (area < 1e-6) return;
        totalArea += area;

        triCenter.copy(va).add(vb).add(vc).divideScalar(3);
        coa.add(triCenter.multiplyScalar(area));

        cb.normalize();
        const px = Math.round(cb.x * 10) / 10;
        const py = Math.round(cb.y * 10) / 10;
        const pz = Math.round(cb.z * 10) / 10;
        const key = `${px},${py},${pz}`;

        let currentArea = normalAreas.get(key) || 0;
        currentArea += area;
        normalAreas.set(key, currentArea);
      }

      if (index) {
        for (let i = 0; i < index.count; i += 3) {
          addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
        }
      } else {
        for (let i = 0; i < pos.count; i += 3) {
          addTriangle(i, i + 1, i + 2);
        }
      }
    }
  });

  if (totalArea === 0) return;
  coa.divideScalar(totalArea);

  const box = new THREE.Box3().setFromObject(meshOrGroup);
  const boxCenter = box.getCenter(new THREE.Vector3());
  const boxSize = box.getSize(new THREE.Vector3());

  const shift = new THREE.Vector3().subVectors(coa, boxCenter);
  const relShift = new THREE.Vector3(
    boxSize.x > 0 ? shift.x / boxSize.x : 0,
    boxSize.y > 0 ? shift.y / boxSize.y : 0,
    boxSize.z > 0 ? shift.z / boxSize.z : 0,
  );

  const candidates = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];

  let maxFlatRatio = 0;
  for (const [key, area] of normalAreas.entries()) {
    const ratio = area / totalArea;
    if (ratio > maxFlatRatio) maxFlatRatio = ratio;
    if (ratio > 0.05) {
      const parts = key.split(",").map(parseFloat);
      const nv = new THREE.Vector3(parts[0], parts[1], parts[2]).normalize();
      candidates.push(nv);
    }
  }

  let bestCandidate = new THREE.Vector3(0, -1, 0);
  let bestScore = -Infinity;

  for (const v of candidates) {
    if (v.lengthSq() < 0.1) continue;
    v.normalize();

    let flatAreaAlign = 0;
    for (const [key, area] of normalAreas.entries()) {
      const parts = key.split(",").map(parseFloat);
      const nv = new THREE.Vector3(parts[0], parts[1], parts[2]).normalize();
      if (nv.dot(v) > 0.95) {
        flatAreaAlign += area;
      }
    }

    const flatRatio = flatAreaAlign / totalArea;
    const shiftScore = relShift.dot(v);

    let bias = 0;
    if (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > 0.99) {
      if (v.z < -0.99) bias = 0.5; // Strong bias for standard Z-up exported files (.stl/.3mf)
      if (v.y < -0.99) bias = 0.1; // Minor fallback for Y-up exports
    }

    // Dampen center-of-area shift calculations for highly organic objects
    let effectiveShift = shiftScore;
    if (maxFlatRatio < 0.02) {
      effectiveShift *= 0.1;
    } else if (maxFlatRatio < 0.05) {
      effectiveShift *= 0.5;
    }

    const score = flatRatio * 3.0 + effectiveShift * 2.0 + bias;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = v.clone();
    }
  }

  const down = new THREE.Vector3(0, -1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    bestCandidate,
    down,
  );
  meshOrGroup.quaternion.copy(quaternion);
  meshOrGroup.updateMatrixWorld(true);
}

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

// ── Shared Model Parsing ──────────────────────────────────────────

async function parseModelToGroup(
  arrayBuffer: ArrayBuffer,
  extension: string,
): Promise<THREE.Group> {
  const group = new THREE.Group();

  try {
    switch (extension.toLowerCase()) {
      case "stl":
        loadSTL(arrayBuffer, group);
        break;
      case "obj":
        loadOBJ(arrayBuffer, group);
        break;
      case "3mf":
        await load3MF(arrayBuffer, group);
        break;
    }
  } catch (e: unknown) {
    console.error("Failed to parse model:", e);
    throw e;
  }

  return group;
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

function loadSTL(arrayBuffer: ArrayBuffer, group: THREE.Group): void {
  const loader = new STLLoader();
  const geometry = loader.parse(arrayBuffer);

  // Some STLs incorrectly specify vertex colors (which default to black)
  // We explicitly remove the color attribute so our designated material color applies
  if (geometry.hasAttribute("color")) {
    geometry.deleteAttribute("color");
  }
  // Also explicitly override the custom flag STLLoader might set
  (geometry as THREE.BufferGeometry & { hasColors?: boolean }).hasColors =
    false;

  // Ensure we have correct normals for lighting calculations (prevents black rendering)
  geometry.computeVertexNormals();

  const material = createMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  group.add(mesh);
}

function loadOBJ(arrayBuffer: ArrayBuffer, group: THREE.Group): void {
  const loader = new OBJLoader();
  const text = new TextDecoder().decode(arrayBuffer);
  const obj = loader.parse(text);

  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = createMaterial();
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // Copy children to our group
  while (obj.children.length > 0) {
    group.add(obj.children[0]);
  }
}

async function load3MF(
  arrayBuffer: ArrayBuffer,
  group: THREE.Group,
): Promise<void> {
  const loader = new ThreeMFLoader();
  const fixedBuffer = await fix3MF(arrayBuffer);
  const obj = loader.parse(fixedBuffer);

  obj.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      // 3MF files often lack pre-computed normals; without them, MeshStandardMaterial renders black
      if (!child.geometry.attributes.normal) {
        child.geometry.computeVertexNormals();
      }

      // Always upgrade to our standard material for consistent lighting/shading
      child.material = createMaterial();
      (child.material as THREE.Material).vertexColors = false;

      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  while (obj.children.length > 0) {
    group.add(obj.children[0]);
  }
}

function createMaterial(): THREE.MeshStandardMaterial {
  const M = VIEWER_CONFIG.material;
  return new THREE.MeshStandardMaterial({
    color: M.color,
    metalness: M.metalness,
    roughness: M.roughness,
    flatShading: false,
  });
}

// ── Camera Fitting ────────────────────────────────────────────────

function computeCameraFit(
  object: THREE.Object3D,
  cam: THREE.PerspectiveCamera,
) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Center the object in X and Z, and place the bottom at Y = 0
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;

  // Re-calculate box after moving the object to origin
  box.setFromObject(object);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = cam.fov * (Math.PI / 180);
  let cameraDistance = Math.abs(maxDim / Math.sin(fov / 2));
  cameraDistance *= VIEWER_CONFIG.camera.padding;

  const direction = new THREE.Vector3(1, 0.7, 1).normalize();
  cam.position.copy(center).add(direction.multiplyScalar(cameraDistance));
  cam.lookAt(center);

  return { center, maxDim };
}

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

export async function renderThumbnail(
  arrayBuffer: ArrayBuffer,
  extension: string,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  ensureThumbnailRenderer(canvas);

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
