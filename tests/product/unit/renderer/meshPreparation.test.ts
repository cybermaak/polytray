import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { prepareModelGroup } from "../../../../src/renderer/lib/meshPreparation";
import { collectSerializedPreviewMeshes } from "../../../../src/renderer/lib/meshSerialization";

function makeVerticalTriangle(indexed: boolean) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,
    0, 2, 0,
    0, 0, 1,
  ], 3));
  if (indexed) geometry.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.position.x = 4;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

test("background preparation orients indexed and nonindexed meshes and returns display bounds", () => {
  for (const indexed of [false, true]) {
    const group = makeVerticalTriangle(indexed);
    const prepared = prepareModelGroup(group);
    const box = new THREE.Box3().setFromObject(group);
    const serialized = collectSerializedPreviewMeshes(group);

    assert.ok(prepared.orientation instanceof THREE.Matrix4);
    assert.ok(prepared.orientation.elements.some((value, index) => value !== new THREE.Matrix4().elements[index]));
    assert.deepEqual(prepared.bounds.min, box.min.toArray());
    assert.deepEqual(prepared.bounds.max, box.max.toArray());
    assert.ok(prepared.bounds.min.every(Number.isFinite));
    assert.ok(prepared.bounds.max.every(Number.isFinite));
    const normals = serialized.meshes[0].geometry.attributes.normal.array;
    assert.equal(normals.length, 9);
    assert.ok(Array.from(normals).every(Number.isFinite));
    for (let offset = 0; offset < normals.length; offset += 3) {
      const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]);
      assert.ok(Math.abs(length - 1) < 1e-6);
    }
    const positions = serialized.meshes[0].geometry.attributes.position.array;
    const serializedBounds = new THREE.Box3().setFromBufferAttribute(
      new THREE.BufferAttribute(positions, 3),
    );
    for (const [actual, expected] of [
      [serializedBounds.min.toArray(), prepared.bounds.min],
      [serializedBounds.max.toArray(), prepared.bounds.max],
    ]) {
      assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) < 1e-6));
    }
  }
});

test('preview and thumbnail preparation produce identical orientation, transformed positions, normals, and bounds', () => {
  const previewGroup = makeVerticalTriangle(true);
  const thumbnailGroup = makeVerticalTriangle(true);
  const previewPreparation = prepareModelGroup(previewGroup);
  const thumbnailPreparation = prepareModelGroup(thumbnailGroup);
  const previewMeshes = collectSerializedPreviewMeshes(previewGroup).meshes;
  const thumbnailMeshes = collectSerializedPreviewMeshes(thumbnailGroup).meshes;

  assert.deepEqual(previewPreparation.orientation.elements, thumbnailPreparation.orientation.elements);
  assert.deepEqual(previewPreparation.bounds, thumbnailPreparation.bounds);
  assert.deepEqual(
    Array.from(previewMeshes[0].geometry.attributes.position.array),
    Array.from(thumbnailMeshes[0].geometry.attributes.position.array),
  );
  assert.deepEqual(
    Array.from(previewMeshes[0].geometry.attributes.normal.array),
    Array.from(thumbnailMeshes[0].geometry.attributes.normal.array),
  );
  const transformedPositions = Array.from(previewMeshes[0].geometry.attributes.position.array);
  assert.ok(transformedPositions.some((value, index) => value !== [0, 0, 0, 0, 2, 0, 0, 0, 1][index]));
});

test("multipart preparation includes each mesh's world transform in bounds", () => {
  const group = new THREE.Group();
  const left = makeVerticalTriangle(true);
  const right = makeVerticalTriangle(false);
  right.position.set(10, 3, -2);
  group.add(left, right);

  const prepared = prepareModelGroup(group);
  const box = new THREE.Box3().setFromObject(group);
  assert.deepEqual(prepared.bounds.min, box.min.toArray());
  assert.deepEqual(prepared.bounds.max, box.max.toArray());
  assert.equal(group.children.length, 2);
  const serialized = collectSerializedPreviewMeshes(group);
  assert.equal(serialized.meshes.length, 2);
  assert.ok(serialized.meshes.every((mesh) => mesh.geometry.attributes.normal));
});
