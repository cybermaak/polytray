import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { collectSerializedPreviewMeshes } from '../../../../src/renderer/lib/meshSerialization';

test('collectSerializedPreviewMeshes drops non-preview attributes but preserves normals and indices', () => {
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
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      [
        0, 0,
        1, 0,
        0, 1,
      ],
      2,
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
  geometry.setIndex([0, 1, 2]);

  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));

  const { meshes } = collectSerializedPreviewMeshes(group);
  const attributes = meshes[0]?.geometry.attributes;

  assert.ok(attributes);
  assert.equal('position' in attributes, true);
  assert.equal('normal' in attributes, true);
  assert.equal('uv' in attributes, false);
  assert.equal('color' in attributes, false);
  assert.deepEqual(Array.from(meshes[0].geometry.index?.array ?? []), [0, 1, 2]);
});

test('collectSerializedPreviewMeshes bakes world transforms into serialized positions', () => {
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
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
      ],
      3,
    ),
  );

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.position.set(3, 4, 5);

  const group = new THREE.Group();
  group.add(mesh);

  const { meshes } = collectSerializedPreviewMeshes(group);
  const positions = Array.from(meshes[0].geometry.attributes.position.array);

  assert.deepEqual(positions, [
    3, 4, 5,
    4, 4, 5,
    3, 5, 5,
  ]);
});
