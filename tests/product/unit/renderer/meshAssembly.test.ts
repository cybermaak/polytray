import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { SerializedMesh } from '../../../../src/shared/types';
import { assembleSerializedMeshes } from '../../../../src/renderer/lib/meshAssembly';

function oversizedMesh(vertexCount: number): SerializedMesh {
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const axis = vertex % 3;
    positions[vertex * 3] = axis === 1 ? 1 : 0;
    positions[vertex * 3 + 1] = axis === 2 ? 1 : 0;
    normals[vertex * 3 + 2] = 1;
  }
  return {
    name: 'oversized',
    geometry: {
      attributes: {
        position: { array: positions, itemSize: 3, normalized: false },
        normal: { array: normals, itemSize: 3, normalized: false },
      },
      index: null,
    },
  };
}

function options(signal: AbortSignal, yieldToFrame: () => Promise<void>, onYield: () => void = () => {}) {
  return {
    signal,
    isCurrent: () => true,
    yieldToFrame: async () => { onYield(); await yieldToFrame(); },
    createMaterial: () => new THREE.MeshBasicMaterial(),
  };
}

test('one oversized mesh is assembled into bounded chunks with cooperative yields', async () => {
  const vertexCount = 210_000;
  let yields = 0;
  const group = await assembleSerializedMeshes(
    [oversizedMesh(vertexCount)],
    options(new AbortController().signal, async () => {}, () => { yields += 1; }),
  );
  assert.ok(group);
  const chunks: THREE.Mesh[] = [];
  group.traverse((object) => { if (object instanceof THREE.Mesh) chunks.push(object); });
  assert.ok(chunks.length > 1);
  assert.ok(yields >= 2);
  assert.ok(chunks.every((mesh) => (mesh.geometry.getAttribute('position')?.count ?? Infinity) <= 32_768));
  assert.equal(chunks.reduce((total, mesh) => total + mesh.geometry.getAttribute('position').count, 0), vertexCount);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
});

test('oversized indexed input is remapped to valid local chunk indices without losing vertices', async () => {
  const source = oversizedMesh(210_000);
  source.geometry.index = { array: Uint32Array.from({ length: 210_000 }, (_, index) => index), itemSize: 1 };
  const group = await assembleSerializedMeshes(
    [source],
    options(new AbortController().signal, async () => {}),
  );
  assert.ok(group);
  const chunks: THREE.Mesh[] = [];
  group.traverse((object) => { if (object instanceof THREE.Mesh) chunks.push(object); });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.reduce((total, chunk) => total + (chunk.geometry.index?.count ?? 0), 0), 210_000);
  for (const chunk of chunks) {
    const positions = chunk.geometry.getAttribute('position');
    const indices = chunk.geometry.getIndex();
    assert.ok(positions.count <= 32_768);
    assert.ok(indices);
    for (let index = 0; index < indices.count; index += 1) assert.ok(indices.getX(index) < positions.count);
  }
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
});

test('abort during a yielded single-mesh assembly disposes partial resources without token replacement', async () => {
  const controller = new AbortController();
  const originalDispose = THREE.BufferGeometry.prototype.dispose;
  let disposedGeometries = 0;
  let disposedMaterials = 0;
  let createdMaterials = 0;
  let releaseYield!: () => void;
  let announceYield!: () => void;
  const yieldSeen = new Promise<void>((resolve) => { announceYield = resolve; });
  const blockedYield = new Promise<void>((resolve) => { releaseYield = resolve; });
  THREE.BufferGeometry.prototype.dispose = function () {
    disposedGeometries += 1;
    return originalDispose.call(this);
  };
  try {
    const assembling = assembleSerializedMeshes([oversizedMesh(210_000)], {
      signal: controller.signal,
      isCurrent: () => true,
      yieldToFrame: () => {
        if (createdMaterials === 0) return Promise.resolve();
        announceYield();
        return blockedYield;
      },
      createMaterial: () => {
        createdMaterials += 1;
        return { dispose() { disposedMaterials += 1; } } as THREE.Material;
      },
    });
    await yieldSeen;
    controller.abort();
    const result = await assembling;
    assert.equal(result, null);
    assert.ok(disposedGeometries > 0);
    assert.ok(disposedMaterials > 0);
    releaseYield();
  } finally {
    THREE.BufferGeometry.prototype.dispose = originalDispose;
    releaseYield?.();
  }
});
