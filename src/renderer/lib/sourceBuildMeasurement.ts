import * as THREE from "three";
import { createAvailableMeasurement, createUnavailableMeasurement, type MeasurementUnit } from "../../shared/model/measurement";
import type { ModelMeasurement } from "../../shared/measurementContracts";

export function sourceBuildMeasurementFromGroup(root: THREE.Object3D, unit: MeasurementUnit): ModelMeasurement {
  root.updateMatrixWorld(true);
  let hasPosition = false;
  let finite = true;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    hasPosition = true;
    if (object.matrixWorld.elements.some((value) => !Number.isFinite(value))) finite = false;
    for (let component = 0; component < position.array.length; component += 1) {
      if (!Number.isFinite(position.array[component])) {
        finite = false;
        break;
      }
    }
  });
  if (!hasPosition || !finite) return invalidGeometryMeasurement(unit);

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const available = bounds.isEmpty()
    ? null
    : createAvailableMeasurement({ x: size.x, y: size.y, z: size.z }, unit);
  if (available) {
    return {
      version: available.version,
      x: available.x,
      y: available.y,
      z: available.z,
      unit: available.unit,
      basis: available.basis,
      status: "verified",
    };
  }

  return invalidGeometryMeasurement(unit);
}

function invalidGeometryMeasurement(unit: MeasurementUnit): ModelMeasurement {
  const unavailable = createUnavailableMeasurement(unit, "Source-build geometry bounds are empty or nonfinite");
  return {
    version: unavailable.version,
    x: null,
    y: null,
    z: null,
    unit: unavailable.unit,
    basis: unavailable.basis,
    status: "unavailable",
    reason: "invalid-geometry",
  };
}
