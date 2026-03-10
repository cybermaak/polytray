import * as THREE from "three";

export function prepareStlGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geometry.hasAttribute("color")) {
    geometry.deleteAttribute("color");
  }

  (geometry as THREE.BufferGeometry & { hasColors?: boolean }).hasColors = false;

  if (!geometry.getAttribute("normal")) {
    geometry.computeVertexNormals();
  }

  return geometry;
}

export function prepareObjGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometry.getAttribute("normal")) {
    geometry.computeVertexNormals();
  }

  return geometry;
}

export function prepare3mfGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let prepared = geometry;

  if (prepared.index) {
    prepared = prepared.toNonIndexed();
  }

  prepared.computeVertexNormals();
  return prepared;
}
