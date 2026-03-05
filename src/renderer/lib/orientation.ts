/**
 * orientation.ts — Smart orientation heuristics for 3D models.
 *
 * Analyzes triangle normals and center-of-area to determine the most
 * likely "bottom" face of a model and rotates it so it sits flat.
 */
import * as THREE from "three";

export function applySmartOrientation(meshOrGroup: THREE.Object3D) {
  let totalArea = 0;
  const normalAreas = new Map<string, number>();
  const coa = new THREE.Vector3();

  meshOrGroup.updateMatrixWorld(true);

  meshOrGroup.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const pos = child.geometry.attributes.position;
      const index = child.geometry.index;
      if (!pos) return;

      const matrixWorld = child.matrixWorld;

      const va = new THREE.Vector3();
      const vb = new THREE.Vector3();
      const vc = new THREE.Vector3();
      const cb = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const triCenter = new THREE.Vector3();

      function addTriangle(a: number, b: number, c: number) {
        va.fromBufferAttribute(pos, a).applyMatrix4(matrixWorld);
        vb.fromBufferAttribute(pos, b).applyMatrix4(matrixWorld);
        vc.fromBufferAttribute(pos, c).applyMatrix4(matrixWorld);

        cb.subVectors(vc, vb);
        ab.subVectors(va, vb);
        cb.cross(ab);

        const area = cb.length() / 2;
        if (area < 1e-6) return;
        totalArea += area;

        triCenter.copy(va).add(vb).add(vc).divideScalar(3);
        coa.add(triCenter.multiplyScalar(area));

        cb.normalize();
        const px = Math.round(cb.x * 10) / 10;
        const py = Math.round(cb.y * 10) / 10;
        const pz = Math.round(cb.z * 10) / 10;
        const key = `${px},${py},${pz}`;

        let currentArea = normalAreas.get(key) || 0;
        currentArea += area;
        normalAreas.set(key, currentArea);
      }

      if (index) {
        for (let i = 0; i < index.count; i += 3) {
          addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
        }
      } else {
        for (let i = 0; i < pos.count; i += 3) {
          addTriangle(i, i + 1, i + 2);
        }
      }
    }
  });

  if (totalArea === 0) return;
  coa.divideScalar(totalArea);

  const box = new THREE.Box3().setFromObject(meshOrGroup);
  const boxCenter = box.getCenter(new THREE.Vector3());
  const boxSize = box.getSize(new THREE.Vector3());

  const shift = new THREE.Vector3().subVectors(coa, boxCenter);
  const relShift = new THREE.Vector3(
    boxSize.x > 0 ? shift.x / boxSize.x : 0,
    boxSize.y > 0 ? shift.y / boxSize.y : 0,
    boxSize.z > 0 ? shift.z / boxSize.z : 0,
  );

  const candidates = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];

  let maxFlatRatio = 0;
  for (const [key, area] of normalAreas.entries()) {
    const ratio = area / totalArea;
    if (ratio > maxFlatRatio) maxFlatRatio = ratio;
    if (ratio > 0.05) {
      const parts = key.split(",").map(parseFloat);
      const nv = new THREE.Vector3(parts[0], parts[1], parts[2]).normalize();
      candidates.push(nv);
    }
  }

  let bestCandidate = new THREE.Vector3(0, -1, 0);
  let bestScore = -Infinity;

  for (const v of candidates) {
    if (v.lengthSq() < 0.1) continue;
    v.normalize();

    let flatAreaAlign = 0;
    for (const [key, area] of normalAreas.entries()) {
      const parts = key.split(",").map(parseFloat);
      const nv = new THREE.Vector3(parts[0], parts[1], parts[2]).normalize();
      if (nv.dot(v) > 0.95) {
        flatAreaAlign += area;
      }
    }

    const flatRatio = flatAreaAlign / totalArea;
    const shiftScore = relShift.dot(v);

    let bias = 0;
    if (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > 0.99) {
      if (v.z < -0.99) bias = 0.5; // Strong bias for standard Z-up exported files (.stl/.3mf)
      if (v.y < -0.99) bias = 0.1; // Minor fallback for Y-up exports
    }

    // Dampen center-of-area shift calculations for highly organic objects
    let effectiveShift = shiftScore;
    if (maxFlatRatio < 0.02) {
      effectiveShift *= 0.1;
    } else if (maxFlatRatio < 0.05) {
      effectiveShift *= 0.5;
    }

    const score = flatRatio * 3.0 + effectiveShift * 2.0 + bias;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = v.clone();
    }
  }

  const down = new THREE.Vector3(0, -1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    bestCandidate,
    down,
  );
  meshOrGroup.quaternion.copy(quaternion);
  meshOrGroup.updateMatrixWorld(true);
}
