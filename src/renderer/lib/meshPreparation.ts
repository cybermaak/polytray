import * as THREE from "three";
import { applySmartOrientation } from "./orientation";

export interface PreparedModelGeometry {
  orientation: THREE.Matrix4;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Prepare expensive geometry facts before ownership crosses to the visible renderer. */
export function prepareModelGroup(root: THREE.Object3D): PreparedModelGeometry {
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry.getAttribute("position")) return;
    if (!child.geometry.getAttribute("normal")) child.geometry.computeVertexNormals();
  });
  applySmartOrientation(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const min = (box.isEmpty() ? new THREE.Vector3() : box.min).toArray() as [number, number, number];
  const max = (box.isEmpty() ? new THREE.Vector3() : box.max).toArray() as [number, number, number];
  return { orientation: new THREE.Matrix4().makeRotationFromQuaternion(root.quaternion), bounds: { min, max } };
}
