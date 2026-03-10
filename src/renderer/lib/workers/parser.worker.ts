import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import {
  prepareObjGeometry,
  prepareStlGeometry,
} from "../meshPrep";
import { collectSerializedMeshes, serializeGeometry } from "../meshSerialization";
import type { SerializedMesh } from "../../../shared/types";

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = async (e) => {
  const { buffer, extension } = e.data;

  try {
    const meshes: SerializedMesh[] = [];
    const allTransferables: ArrayBuffer[] = [];

    if (extension.toLowerCase() === "stl") {
      const loader = new STLLoader();
      const geometry = prepareStlGeometry(loader.parse(buffer));
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
          child.geometry = prepareObjGeometry(child.geometry);
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
