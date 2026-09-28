import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import {
  prepareObjGeometry,
  prepareStlGeometry,
} from "../meshPrep";
import { collectSerializedPreviewMeshes } from "../meshSerialization";
import { prepareModelGroup } from "../meshPreparation";
import type { PreparedPreviewMeshes } from "../../../shared/types";
import type { ModelMeasurement } from "../../../shared/measurementContracts";

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = async (e) => {
  const { buffer, extension } = e.data;
  let group: THREE.Group | null = null;

  try {
    group = new THREE.Group();

    if (extension.toLowerCase() === "stl") {
      const loader = new STLLoader();
      const geometry = prepareStlGeometry(loader.parse(buffer));
      group.add(new THREE.Mesh(geometry));
    } else if (extension.toLowerCase() === "obj") {
      const loader = new OBJLoader();
      const text = new TextDecoder().decode(buffer);
      group = loader.parse(text);

      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry = prepareObjGeometry(child.geometry);
        }
      });
    } else {
        throw new Error(`Unsupported worker parsing for extension: ${extension}`);
    }

    group.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(group);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const sourceBuildMeasurements: ModelMeasurement = sourceBounds.isEmpty()
      ? { version: 1, x: null, y: null, z: null, unit: "model-unit", basis: "source-build", status: "unavailable", reason: "invalid-geometry" }
      : { version: 1, x: sourceSize.x, y: sourceSize.y, z: sourceSize.z, unit: "model-unit", basis: "source-build", status: "verified" };
    const preparationStartedAt = performance.now();
    const prepared = prepareModelGroup(group);
    const preparationDurationMs = performance.now() - preparationStartedAt;
    const serialized = collectSerializedPreviewMeshes(group);
    const orientation = prepared.orientation.toArray() as PreparedPreviewMeshes["orientation"];
    const resultPayload: PreparedPreviewMeshes = { meshes: serialized.meshes, orientation, bounds: prepared.bounds, preparationDurationMs, measurements: sourceBuildMeasurements };
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    ctx.postMessage(resultPayload, serialized.transferables);
  } catch (err) {
    group?.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    ctx.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
