import * as THREE from "three";
import type { SerializedAttribute, SerializedGeometry, SerializedIndex, SerializedMesh } from "../../shared/types";

const PREVIEW_ATTRIBUTE_NAMES = new Set(["position", "normal"]);

export function serializeGeometry(
  geometry: THREE.BufferGeometry,
): { data: SerializedGeometry; transferables: ArrayBuffer[] } {
  return serializeGeometryAttributes(geometry);
}

export function serializePreviewGeometry(
  geometry: THREE.BufferGeometry,
): { data: SerializedGeometry; transferables: ArrayBuffer[] } {
  return serializeGeometryAttributes(geometry, PREVIEW_ATTRIBUTE_NAMES);
}

function serializeGeometryAttributes(
  geometry: THREE.BufferGeometry,
  allowedAttributes?: Set<string>,
): { data: SerializedGeometry; transferables: ArrayBuffer[] } {
  const attributes: Record<string, SerializedAttribute> = {};
  const transferables: ArrayBuffer[] = [];

  for (const name of Object.keys(geometry.attributes)) {
    if (allowedAttributes && !allowedAttributes.has(name)) {
      continue;
    }
    const attr = geometry.getAttribute(name);
    if (attr instanceof THREE.BufferAttribute) {
      attributes[name] = {
        array: attr.array as Float32Array,
        itemSize: attr.itemSize,
        normalized: attr.normalized,
      };
      if (attr.array.buffer instanceof ArrayBuffer) {
        transferables.push(attr.array.buffer);
      }
    }
  }

  const index = geometry.getIndex();
  let indexData: SerializedIndex | null = null;
  if (index) {
    indexData = {
      array: index.array as Uint16Array | Uint32Array,
      itemSize: index.itemSize,
    };
    if (index.array.buffer instanceof ArrayBuffer) {
      transferables.push(index.array.buffer);
    }
  }

  return {
    data: { attributes, index: indexData },
    transferables,
  };
}

export function collectSerializedMeshes(root: THREE.Object3D) {
  return collectSerializedMeshesInternal(root, serializeGeometry);
}

export function collectSerializedPreviewMeshes(root: THREE.Object3D) {
  return collectSerializedMeshesInternal(root, serializePreviewGeometry);
}

function collectSerializedMeshesInternal(
  root: THREE.Object3D,
  serialize: (
    geometry: THREE.BufferGeometry,
  ) => { data: SerializedGeometry; transferables: ArrayBuffer[] },
) {
  const meshes: SerializedMesh[] = [];
  const transferables: ArrayBuffer[] = [];
  const geometryUseCounts = new Map<THREE.BufferGeometry, number>();
  const identityMatrix = new THREE.Matrix4();

  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      geometryUseCounts.set(
        child.geometry,
        (geometryUseCounts.get(child.geometry) || 0) + 1,
      );
    }
  });

  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry =
        (geometryUseCounts.get(child.geometry) || 0) > 1
          ? child.geometry.clone()
          : child.geometry;

      if (!child.matrixWorld.equals(identityMatrix)) {
        geometry.applyMatrix4(child.matrixWorld);
      }

      const { data, transferables: meshTransfers } = serialize(geometry);
      meshes.push({
        geometry: data,
        name: child.name,
      });
      transferables.push(...meshTransfers);

      if (geometry !== child.geometry) {
        geometry.dispose();
      }
    }
  });

  return { meshes, transferables };
}
