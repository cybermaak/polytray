import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const ctx: Worker = self as unknown as Worker;

interface SerializedAttribute {
  array: Float32Array;
  itemSize: number;
  normalized: boolean;
}

interface SerializedIndex {
  array: Uint16Array | Uint32Array;
  itemSize: number;
}

export interface SerializedGeometry {
  attributes: Record<string, SerializedAttribute>;
  index: SerializedIndex | null;
}

export interface SerializedMesh {
  geometry: SerializedGeometry;
  name: string;
}

/**
 * Extracts serializable data from a Three.js BufferGeometry.
 */
function serializeGeometry(geometry: THREE.BufferGeometry) {
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
      array: index.array as Uint32Array,
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

ctx.onmessage = async (e) => {
  const { buffer, extension } = e.data;

  try {
    const meshes: SerializedMesh[] = [];
    const allTransferables: ArrayBuffer[] = [];

    if (extension.toLowerCase() === "stl") {
      const loader = new STLLoader();
      const geometry = loader.parse(buffer);
      const { data, transferables } = serializeGeometry(geometry);
      meshes.push({
        geometry: data,
        name: "model",
      });
      allTransferables.push(...transferables);
    } else if (extension.toLowerCase() === "obj") {
      const loader = new OBJLoader();
      const text = new TextDecoder().decode(buffer);
      const group = loader.parse(text);

      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const { data, transferables } = serializeGeometry(child.geometry);
          meshes.push({
            geometry: data,
            name: child.name,
          });
          allTransferables.push(...transferables);
        }
      });
    } else {
        throw new Error(`Unsupported worker parsing for extension: ${extension}`);
    }

    ctx.postMessage({ meshes }, allTransferables);
  } catch (err) {
    ctx.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
