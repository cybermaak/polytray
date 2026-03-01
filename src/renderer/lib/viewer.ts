import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import JSZip from "jszip";

let scene, camera, renderer, controls;
let currentModel = null;
let animationId = null;
let wireframeMode = false;

// Multi-Model Cache
let multiModelMeshes = [];
let activeSubModelIndex = -1; // -1 means show all
let _multiModelContainer = null;
function getMultiModelContainer() {
  if (!_multiModelContainer) {
    _multiModelContainer = document.getElementById("viewer-multi-model");
  }
  return _multiModelContainer;
}
let container = null;

// ── Initialization ────────────────────────────────────────────────

export function initViewer(containerEl) {
  container = containerEl;

  // Clean up any previous viewer
  disposeViewer();

  const width = container.clientWidth;
  const height = container.clientHeight;

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
  camera.position.set(3, 2, 3);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;

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
  // Ambient
  const ambient = new THREE.AmbientLight(0x404050, 0.6);
  scene.add(ambient);

  // Hemisphere
  const hemi = new THREE.HemisphereLight(0x8888cc, 0x443322, 0.5);
  scene.add(hemi);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 8, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -10;
  dirLight.shadow.camera.right = 10;
  dirLight.shadow.camera.top = 10;
  dirLight.shadow.camera.bottom = -10;
  camera.add(dirLight);

  // Fill light
  const fillLight = new THREE.DirectionalLight(0x3b82f6, 0.4);
  fillLight.position.set(-3, 2, -3);
  camera.add(fillLight);

  // Rim light
  const rimLight = new THREE.DirectionalLight(0x3b82f6, 0.3);
  rimLight.position.set(0, -2, -5);
  camera.add(rimLight);

  scene.add(camera);
}

function setupGrid() {
  const grid = new THREE.GridHelper(20, 40, 0x3a3a55, 0x282840);
  grid.material.opacity = 0.7;
  grid.material.transparent = true;
  scene.add(grid);
}

function animate() {
  animationId = requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function handleResize() {
  if (!container || !camera || !renderer) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// ── Model Loading ─────────────────────────────────────────────────

function applySmartOrientation(meshOrGroup) {
  let totalArea = 0;
  const normalAreas = new Map();
  const coa = new THREE.Vector3();

  meshOrGroup.updateMatrixWorld(true);

  meshOrGroup.traverse((child) => {
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

      function addTriangle(a, b, c) {
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

export async function loadModel(arrayBuffer, extension, name) {
  // Remove previous model
  if (currentModel) {
    scene.remove(currentModel);
    disposeObject(currentModel);
    currentModel = null;
  }

  const group = new THREE.Group();
  group.name = name;

  try {
    switch (extension.toLowerCase()) {
      case "stl":
        await loadSTL(arrayBuffer, group);
        break;
      case "obj":
        await loadOBJ(arrayBuffer, group);
        break;
      case "3mf":
        await load3MF(arrayBuffer, group);
        break;
    }
  } catch (e) {
    console.error("Failed to load model:", e);
    throw e;
  }

  // Apply smart orientation heuristics
  applySmartOrientation(group);

  // Normalize scale so max dimension is 10 units relative to the standard plane grid
  const scaledBox = new THREE.Box3().setFromObject(group);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
  if (maxDim > 0) {
    const scale = 10.0 / maxDim;
    group.scale.set(scale, scale, scale);
    group.updateMatrixWorld(true);
  }

  scene.add(group);
  currentModel = group;

  // Render multi-model carousel if applicable
  await updateMultiModelThumbnailStrip(group);

  // Auto-fit camera
  fitCameraToObject(group);

  wireframeMode = false;
}

async function updateMultiModelThumbnailStrip(group) {
  const multiModelContainer = getMultiModelContainer();
  if (!multiModelContainer) return;

  multiModelMeshes = [];
  activeSubModelIndex = -1;
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
      if (hasGeometry) multiModelMeshes.push(child);
    }
  }

  // If there's only 1 thing, no need for a carousel
  if (multiModelMeshes.length < 2) return;

  // We have multiple distinct models! Let's build a thumbnail strip.
  multiModelContainer.classList.remove("hidden");

  // We need a temporary offscreen canvas for rendering mini-thumbnails
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 128; // high-res enough for 64px display
  tempCanvas.height = 128;

  // Wait a frame so the UI flexbox can settle before generating thumbs
  await new Promise((r) => setTimeout(r, 10));

  for (let i = 0; i < multiModelMeshes.length; i++) {
    const sub = multiModelMeshes[i];

    // Hide everything else temporarily to take a picture
    multiModelMeshes.forEach((m, idx) => {
      m.visible = idx === i;
    });

    // Render snapshot
    fitCameraToObject(sub); // zoom camera tight on this specific sub-model
    renderer.render(scene, camera);

    const thumbDiv = document.createElement("div");
    thumbDiv.className = "multi-model-thumb";

    // We can just grab the data-url right out of our main WebGL canvas since it was preserved!
    const img = document.createElement("img");
    img.src = renderer.domElement.toDataURL("image/png");

    thumbDiv.appendChild(img);
    thumbDiv.onclick = () => selectSubModel(i, thumbDiv);
    multiModelContainer.appendChild(thumbDiv);
  }

  // Add a "Show All" button at the start? Or just rely on re-clicking to toggle.
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
  multiModelMeshes.forEach((m) => (m.visible = true));
  fitCameraToObject(group); // Refit the main camera back to the whole group
}

function selectSubModel(index, htmlElement) {
  // Update UI active state
  const mc = getMultiModelContainer();
  if (mc) {
    const thumbs = mc.querySelectorAll(".multi-model-thumb");
    thumbs.forEach((el) => el.classList.remove("active"));
  }
  htmlElement.classList.add("active");

  activeSubModelIndex = index;

  if (index === -1) {
    // Show all
    multiModelMeshes.forEach((m) => (m.visible = true));
    fitCameraToObject(currentModel);
  } else {
    // Show specifically the one clicked
    multiModelMeshes.forEach((m, idx) => {
      m.visible = idx === index;
    });
    fitCameraToObject(multiModelMeshes[index]);
  }
}

function loadSTL(arrayBuffer, group) {
  return new Promise<void>((resolve) => {
    const loader = new STLLoader();
    const geometry = loader.parse(arrayBuffer);

    const material = createMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    group.add(mesh);
    resolve();
  });
}

function loadOBJ(arrayBuffer, group) {
  return new Promise<void>((resolve) => {
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
    resolve();
  });
}

async function fix3MF(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    let mainModelFile = null;
    for (const filename of Object.keys(zip.files)) {
      if (
        filename.toLowerCase() === "3d/3dmodel.model" ||
        filename.toLowerCase() === "/3d/3dmodel.model"
      ) {
        mainModelFile = filename;
        break;
      }
    }
    if (!mainModelFile) return buffer;

    const repairXmlString = (xmlString) => {
      let fixed = xmlString;
      if (fixed.includes("p:") && !fixed.includes("xmlns:p=")) {
        fixed = fixed.replace(
          /<model\s+/,
          '<model xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ',
        );
      }
      if (fixed.includes("slic3rpe:") && !fixed.includes("xmlns:slic3rpe=")) {
        fixed = fixed.replace(
          /<model\s+/,
          '<model xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" ',
        );
      }
      return fixed;
    };

    let mainXml = await zip.file(mainModelFile).async("string");
    const repairedMainXml = repairXmlString(mainXml);
    let modified = repairedMainXml !== mainXml;

    if (modified) {
      zip.file(mainModelFile, repairedMainXml);
      mainXml = repairedMainXml;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(mainXml, "application/xml");
    const resources = doc.querySelector("resources");
    if (!resources) return buffer;

    const components = doc.querySelectorAll("component");

    for (const comp of components) {
      const pathAttr =
        comp.getAttribute("path") ||
        comp.getAttribute("p:path") ||
        comp.getAttribute("slic3rpe:path");
      if (pathAttr) {
        let subFile = pathAttr;
        if (subFile.startsWith("/")) subFile = subFile.substring(1);

        if (zip.file(subFile)) {
          let subXml = await zip.file(subFile).async("string");
          subXml = repairXmlString(subXml);

          const subDoc = parser.parseFromString(subXml, "application/xml");
          const subObjects = subDoc.querySelectorAll("object");

          for (const obj of subObjects) {
            const oldId = obj.getAttribute("id");
            const newId = subFile.replace(/[^a-zA-Z0-9]/g, "_") + "_" + oldId;
            obj.setAttribute("id", newId);

            if (comp.getAttribute("objectid") === oldId) {
              comp.setAttribute("objectid", newId);
            }

            comp.removeAttribute("path");
            comp.removeAttribute("p:path");
            comp.removeAttribute("slic3rpe:path");

            resources.appendChild(doc.importNode(obj, true));
          }
        }
      }
    }

    if (modified) {
      const serializer = new XMLSerializer();
      const newXml = serializer.serializeToString(doc);
      zip.file(mainModelFile, newXml);
      const newBufferInfo = await zip.generateAsync({ type: "arraybuffer" });
      return newBufferInfo;
    }
  } catch (e) {
    console.warn("Failed attempting to auto-repair 3MF zip contents:", e);
  }
  return buffer;
}

function load3MF(arrayBuffer, group) {
  return new Promise<void>(async (resolve, reject) => {
    const loader = new ThreeMFLoader();
    try {
      const fixedBuffer = await fix3MF(arrayBuffer);
      const obj = loader.parse(fixedBuffer);

      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Always apply our standard material for consistent appearance
          child.material = createMaterial();
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      while (obj.children.length > 0) {
        group.add(obj.children[0]);
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function createMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x8888aa,
    metalness: 0.15,
    roughness: 0.6,
    flatShading: false,
  });
}

// ── Camera Fitting ────────────────────────────────────────────────

function fitCameraToObject(object) {
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
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = Math.abs(maxDim / Math.sin(fov / 2));

  // Add a little padding
  cameraDistance *= 1.2;

  const direction = new THREE.Vector3(1, 0.7, 1).normalize();
  camera.position.copy(center).add(direction.multiplyScalar(cameraDistance));
  camera.lookAt(center);

  controls.target.copy(center);
  controls.minDistance = maxDim * 0.1;
  controls.maxDistance = maxDim * 10;
  controls.update();

  camera.updateProjectionMatrix();
}

export function resetCamera() {
  if (currentModel) {
    fitCameraToObject(currentModel);
  }
}

// ── Wireframe Toggle ──────────────────────────────────────────────

export function toggleWireframe() {
  wireframeMode = !wireframeMode;
  if (currentModel) {
    currentModel.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        child.material.wireframe = wireframeMode;
      }
    });
  }
}

// ── Cleanup ───────────────────────────────────────────────────────

export function disposeViewer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  window.removeEventListener("resize", handleResize);

  if (currentModel) {
    disposeObject(currentModel);
    currentModel = null;
  }

  if (controls) {
    controls.dispose();
    controls = null;
  }

  if (renderer) {
    renderer.dispose();
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  scene = null;
  camera = null;
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

// ── Thumbnail Rendering (used by thumbnail generator) ─────────────

let thumbRenderer = null;
let thumbScene = null;
let thumbCamera = null;

function ensureThumbnailRenderer(canvas) {
  if (thumbRenderer) return;

  thumbRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  });
  thumbRenderer.setSize(256, 256);
  thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  thumbRenderer.toneMappingExposure = 1.2;

  thumbCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);

  thumbScene = new THREE.Scene();

  // Cinematic neutral lighting (permanent)
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  thumbScene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  thumbScene.add(hemi);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(5, 5, 5);
  thumbScene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-5, 0, -5);
  thumbScene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
  rimLight.position.set(0, 5, -5);
  thumbScene.add(rimLight);
}

export function renderThumbnail(arrayBuffer, extension, canvas) {
  return new Promise(async (resolve, reject) => {
    ensureThumbnailRenderer(canvas);

    try {
      let geometry;
      const material = new THREE.MeshStandardMaterial({
        color: 0x8888aa,
        metalness: 0.15,
        roughness: 0.6,
      });

      if (extension === "stl") {
        geometry = new STLLoader().parse(arrayBuffer);
      } else if (extension === "obj") {
        const text = new TextDecoder().decode(arrayBuffer);
        const obj = new OBJLoader().parse(text);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && !geometry) {
            geometry = child.geometry;
          }
        });
      } else if (extension === "3mf") {
        const fixedBuffer = await fix3MF(arrayBuffer);
        const obj = new ThreeMFLoader().parse(fixedBuffer);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && !geometry) {
            geometry = child.geometry;
          }
        });
      }

      if (!geometry) {
        resolve(null);
        return;
      }

      // Ensure smooth normals
      if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
      }

      const mesh = new THREE.Mesh(geometry, material);

      // Apply smart orientation heuristics
      applySmartOrientation(mesh);

      thumbScene.add(mesh);

      // Fit camera
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      mesh.position.x -= center.x;
      mesh.position.z -= center.z;
      mesh.position.y -= box.min.y;

      // Re-calculate box after repositioning (match fitCameraToObject logic)
      box.setFromObject(mesh);
      box.getCenter(center);

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = thumbCamera.fov * (Math.PI / 180);
      let dist = Math.abs(maxDim / Math.sin(fov / 2)) * 1.2;

      const direction = new THREE.Vector3(1, 0.7, 1).normalize();
      thumbCamera.position.copy(center).add(direction.multiplyScalar(dist));
      thumbCamera.lookAt(center);

      thumbRenderer.render(thumbScene, thumbCamera);

      // Get data URL
      const dataUrl = canvas.toDataURL("image/png");

      // Cleanup the mesh (but keep the renderer/scene/lights)
      thumbScene.remove(mesh);
      geometry.dispose();
      material.dispose();

      resolve(dataUrl);
    } catch (e) {
      reject(e);
    }
  });
}
