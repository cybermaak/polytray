import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import test from 'node:test';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

import { createModelFixtures, reviseFixture } from '../fixtures/performanceFixtures';
import { inspectFast3mfPreviewSupport, parseFast3mfPreviewGroup } from '../../../src/renderer/lib/fast3mfPreviewParser';

function asArrayBuffer(buffer: Buffer) { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer; }

test('model fixture generator covers parser and archive workload shapes without committed binaries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-performance-model-test-'));
  try {
    const fixtures = await createModelFixtures(root);
    for (const name of ['normal.stl', 'malformed.stl', 'dense-single-mesh.stl', 'normal.obj', 'malformed.obj', 'multipart.obj', 'normal.3mf', 'malformed.3mf', 'component-transform.3mf', 'build-transform.3mf', 'unit-inch.3mf', 'unsupported.3mf', 'external-component.3mf']) {
      assert.ok(fs.statSync(fixtures.files[name]).size > 0, `${name} should be generated`);
    }
    const zip = await JSZip.loadAsync(fs.readFileSync(fixtures.archivePath));
    assert.equal(Object.keys(zip.files).filter((name) => name.endsWith('.stl')).length, 501);
    const multipart = new OBJLoader().parse(fs.readFileSync(fixtures.files['multipart.obj'], 'utf8'));
    const partMinX = multipart.children.map((part) => new THREE.Box3().setFromObject(part).min.x).sort((a, b) => a - b);
    assert.deepEqual(partMinX, [0, 3, 6]);
    const malformedObj = new OBJLoader().parse(fs.readFileSync(fixtures.files['malformed.obj'], 'utf8'));
    let malformedObjHasNonFinite = false;
    malformedObj.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const positions = node.geometry.getAttribute('position').array;
        malformedObjHasNonFinite ||= Array.from(positions).some((value) => !Number.isFinite(value));
      }
    });
    assert.equal(malformedObjHasNonFinite, true);
    assert.throws(() => new STLLoader().parse(asArrayBuffer(fs.readFileSync(fixtures.files['malformed.stl']))));
    const dense = new STLLoader().parse(asArrayBuffer(fs.readFileSync(fixtures.files['dense-single-mesh.stl'])));
    assert.equal(dense.getAttribute('position').count / 3, 20_000);
    const support = async (name: string) => inspectFast3mfPreviewSupport(asArrayBuffer(fs.readFileSync(fixtures.files[name])));
    assert.equal((await support('normal.3mf')).supported, true);
    assert.equal((await support('unit-inch.3mf')).supported, true);
    assert.equal((await support('unsupported.3mf')).supported, false);
    assert.equal((await support('external-component.3mf')).supported, false);
    await assert.rejects(parseFast3mfPreviewGroup(asArrayBuffer(fs.readFileSync(fixtures.files['malformed.3mf']))));
    const transformed = await parseFast3mfPreviewGroup(asArrayBuffer(fs.readFileSync(fixtures.files['build-transform.3mf'])));
    transformed.updateMatrixWorld(true);
    const transformedBounds = new THREE.Box3().setFromObject(transformed);
    assert.deepEqual(transformedBounds.min.toArray(), [5, 0, 0]);
    assert.deepEqual(transformedBounds.max.toArray(), [25, 20, 0]);
    const component = await parseFast3mfPreviewGroup(asArrayBuffer(fs.readFileSync(fixtures.files['component-transform.3mf'])));
    const componentBounds = new THREE.Box3().setFromObject(component);
    assert.deepEqual(componentBounds.min.toArray(), [20, 0, 0]);
    assert.deepEqual(componentBounds.max.toArray(), [21, 1, 0]);
    const original = fs.readFileSync(fixtures.revisions[0]);
    const changed = reviseFixture(fixtures.revisions[0], Buffer.concat([original, Buffer.from('revision')]), 1_800_000_000_000);
    assert.ok(changed.mtimeMs >= 1_800_000_000_000 - 2);
    assert.equal(changed.sizeBytes, original.length + Buffer.byteLength('revision'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
