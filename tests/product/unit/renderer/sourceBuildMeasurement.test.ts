import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { sourceBuildMeasurementFromGroup } from '../../../../src/renderer/lib/sourceBuildMeasurement';

test('nonfinite source geometry yields unavailable source-build measurements', () => {
  for (const invalidCoordinate of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, invalidCoordinate, 1,
    ], 3));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry));

    const measurement = sourceBuildMeasurementFromGroup(group, 'model-unit');
    assert.deepEqual(measurement, {
      version: 1,
      x: null,
      y: null,
      z: null,
      unit: 'model-unit',
      basis: 'source-build',
      status: 'unavailable',
      reason: 'invalid-geometry',
    });
  }
});
