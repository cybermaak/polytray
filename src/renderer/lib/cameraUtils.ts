/**
 * cameraUtils.ts — Camera fitting and positioning utilities.
 *
 * Shared between the main viewer and thumbnail renderer.
 */
import * as THREE from "three";
import { VIEWER_CONFIG } from "./viewerConfig";

/**
 * Computes the optimal camera position to frame an object.
 * Also repositions the object so its base sits on the grid floor.
 */
export function computeCameraFit(
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
