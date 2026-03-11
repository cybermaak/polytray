/**
 * modelParsers.ts — Format-specific 3D model loaders.
 *
 * Pure functions that parse ArrayBuffer data into Three.js Groups
 * for STL, OBJ, and 3MF formats.
 */
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { fix3MF } from "./threemf-repair";
import { VIEWER_CONFIG } from "./viewerConfig";
import {
  prepare3mfGeometry,
  prepareObjGeometry,
  prepareStlGeometry,
} from "./meshPrep";

let currentModelColor: number | string = VIEWER_CONFIG.material.color;

export function setModelColor(hex: string) {
  currentModelColor = parseInt(hex.replace("#", ""), 16);
}

export function createMaterial(): THREE.MeshStandardMaterial {
  const M = VIEWER_CONFIG.material;
  return new THREE.MeshStandardMaterial({
    color: currentModelColor,
    metalness: M.metalness,
    roughness: M.roughness,
    flatShading: false,
  });
}

function loadSTL(arrayBuffer: ArrayBuffer, group: THREE.Group): void {
  const loader = new STLLoader();
  const geometry = prepareStlGeometry(loader.parse(arrayBuffer));

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
      child.geometry = prepareObjGeometry(child.geometry);
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
      child.geometry = prepare3mfGeometry(child.geometry);

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

/**
 * Parses an ArrayBuffer into a Three.js Group based on file extension.
 */
export async function parseModelToGroup(
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
