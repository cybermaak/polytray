import * as THREE from "three";
import type { SerializedAttribute, SerializedGeometry, SerializedIndex, SerializedMesh } from "../../shared/types";

export function serializeGeometry(
  geometry: THREE.BufferGeometry,
): { data: SerializedGeometry; transferables: ArrayBuffer[] } {
  const attributes: Record<string, SerializedAttribute> = {};
  const transferables: ArrayBuffer[] = [];

  for (const name of Object.keys(geometry.attributes)) {
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
  const meshes: SerializedMesh[] = [];
  const transferables: ArrayBuffer[] = [];

  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
      const { data, transferables: meshTransfers } = serializeGeometry(geometry);
      meshes.push({
        geometry: data,
        name: child.name,
      });
      transferables.push(...meshTransfers);
    }
  });

  return { meshes, transferables };
}
