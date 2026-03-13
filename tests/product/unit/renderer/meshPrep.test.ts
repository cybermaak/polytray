import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { prepareStlGeometry } from '../../../../src/renderer/lib/meshPrep';

test('prepareStlGeometry strips color data and recomputes invalid normals', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(
      [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ],
      3,
    ),
  );
  (geometry as THREE.BufferGeometry & { hasColors?: boolean }).hasColors = true;

  const prepared = prepareStlGeometry(geometry);
  const normals = prepared.getAttribute('normal');

  assert.equal(prepared.hasAttribute('color'), false);
  assert.equal((prepared as THREE.BufferGeometry & { hasColors?: boolean }).hasColors, false);
  assert.deepEqual(Array.from(normals.array), [
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
});
