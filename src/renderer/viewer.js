import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let currentModel = null;
let wireframeMode = false;
let animationId = null;
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
  scene.background = new THREE.Color(0x0a0a0f);

  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
  camera.position.set(3, 2, 3);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
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

  // Main directional
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
  scene.add(dirLight);

  // Fill light
  const fillLight = new THREE.DirectionalLight(0x3b82f6, 0.4);
  fillLight.position.set(-3, 2, -3);
  scene.add(fillLight);

  // Rim light
  const rimLight = new THREE.DirectionalLight(0x3b82f6, 0.3);
  rimLight.position.set(0, -2, -5);
  scene.add(rimLight);
}

function setupGrid() {
  const grid = new THREE.GridHelper(20, 40, 0x222233, 0x161622);
  grid.material.opacity = 0.5;
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

  scene.add(group);
  currentModel = group;

  // Auto-fit camera
  fitCameraToObject(group);

  wireframeMode = false;
}

function loadSTL(arrayBuffer, group) {
  return new Promise((resolve) => {
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
  return new Promise((resolve) => {
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

function load3MF(arrayBuffer, group) {
  return new Promise((resolve, reject) => {
    const loader = new ThreeMFLoader();
    try {
      const obj = loader.parse(arrayBuffer);

      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (!child.material || child.material.type === "MeshBasicMaterial") {
            child.material = createMaterial();
          }
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

  // Center the object
  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
  cameraDistance *= 1.6; // Add some padding

  const direction = new THREE.Vector3(1, 0.7, 1).normalize();
  camera.position.copy(direction.multiplyScalar(cameraDistance));
  camera.lookAt(0, 0, 0);

  controls.target.set(0, 0, 0);
  controls.minDistance = maxDim * 0.1;
  controls.maxDistance = maxDim * 10;
  controls.update();
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

export function renderThumbnail(arrayBuffer, extension, canvas) {
  return new Promise((resolve, reject) => {
    const thumbScene = new THREE.Scene();
    thumbScene.background = new THREE.Color(0x2a2a3a);

    const thumbCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);

    const thumbRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    thumbRenderer.setSize(256, 256);
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbRenderer.toneMappingExposure = 2.0;

    // Strong lighting for visible thumbnails
    const ambient = new THREE.AmbientLight(0xffffff, 1.5);
    thumbScene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xccccff, 0x886644, 1.0);
    thumbScene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(3, 6, 4);
    thumbScene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.8);
    fillLight.position.set(-3, 2, -2);
    thumbScene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
    rimLight.position.set(0, -1, -4);
    thumbScene.add(rimLight);

    try {
      let geometry;
      const material = new THREE.MeshStandardMaterial({
        color: 0xb0b8d0,
        metalness: 0.1,
        roughness: 0.5,
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
        const obj = new ThreeMFLoader().parse(arrayBuffer);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && !geometry) {
            geometry = child.geometry;
          }
        });
      }

      if (!geometry) {
        thumbRenderer.dispose();
        resolve(null);
        return;
      }

      // Ensure smooth normals
      if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
      }

      const mesh = new THREE.Mesh(geometry, material);
      thumbScene.add(mesh);

      // Fit camera
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      mesh.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = thumbCamera.fov * (Math.PI / 180);
      let dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

      thumbCamera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
      thumbCamera.lookAt(0, 0, 0);

      thumbRenderer.render(thumbScene, thumbCamera);

      // Get data URL
      const dataUrl = canvas.toDataURL("image/png");

      // Cleanup
      geometry.dispose();
      material.dispose();
      thumbRenderer.dispose();

      resolve(dataUrl);
    } catch (e) {
      thumbRenderer.dispose();
      reject(e);
    }
  });
}
