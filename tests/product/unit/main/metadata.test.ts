import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import JSZip from 'jszip';

import { extractMetadata, extractMetadataFromBuffer } from "../../../../src/main/metadata";

const fixtureDir = path.resolve(process.cwd(), "tests/support/fixtures");

test("extractMetadata includes dimensions for binary STL fixtures", async () => {
  const metadata = await extractMetadata(
    path.join(fixtureDir, "test_model_a.stl"),
    "stl",
  );

  assert.equal(metadata.vertexCount, 36);
  assert.equal(metadata.faceCount, 12);
  assert.deepEqual(metadata.dimensions, { version: 1, x: 1, y: 1, z: 1, unit: 'model-unit', basis: 'source-build', status: 'available' });
});

test("extractMetadata includes dimensions for OBJ fixtures", async () => {
  const metadata = await extractMetadata(
    path.join(fixtureDir, "test_cube.obj"),
    "obj",
  );

  assert.equal(metadata.vertexCount, 8);
  assert.equal(metadata.faceCount, 6);
  assert.deepEqual(metadata.dimensions, { version: 1, x: 1, y: 1, z: 1, unit: 'model-unit', basis: 'source-build', status: 'available' });
});

test("extractMetadata rejects truncated binary STL input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-metadata-invalid-"));
  const filePath = path.join(dir, "truncated.stl");
  const data = Buffer.alloc(84);
  data.write("binary STL", 0, "ascii");
  data.writeUInt32LE(2, 80);
  fs.writeFileSync(filePath, data);
  try {
    const result = await extractMetadata(filePath, "stl");
    assert.equal(result.dimensions?.status, 'unavailable');
    assert.match(result.dimensions?.status === 'unavailable' ? result.dimensions.reason : '', /truncated|malformed/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("extractMetadata counts large OBJ input incrementally and respects cancellation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-metadata-stream-"));
  const filePath = path.join(dir, "large.obj");
  fs.writeFileSync(filePath, Array.from({ length: 30_000 }, (_, index) => `v ${index} 2 -3\nf 1 2 3\n`).join(""));
  const emptyPath = path.join(dir, "empty.obj");
  fs.writeFileSync(emptyPath, "");
  try {
    const result = await extractMetadata(filePath, "obj");
    assert.equal(result.vertexCount, 30_000);
    assert.equal(result.faceCount, 30_000);
    assert.deepEqual(result.dimensions, { version: 1, x: 29_999, y: 0, z: 0, unit: 'model-unit', basis: 'source-build', status: 'available' });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(extractMetadata(emptyPath, "obj", { signal: controller.signal }), /cancel/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('extractMetadataFromBuffer persists source-build 3MF bounds with unit conversion once', async () => {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1" transform="2 0 0 0 2 0 0 0 2 10 0 0"/></build></model>`);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const summary = await extractMetadataFromBuffer(bytes, '3mf');
  assert.deepEqual(summary.dimensions, { version: 1, x: 20, y: 20, z: 0, unit: 'mm', basis: 'source-build', status: 'available' });
});

test('unsupported 3MF measurements and unknown formats remain explicitly unavailable', async () => {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<model unit="parsec" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`);
  const unknown = await extractMetadataFromBuffer(await zip.generateAsync({ type: 'nodebuffer' }), '3mf');
  assert.equal(unknown.dimensions.status, 'unavailable');
  if (unknown.dimensions.status === 'unavailable') assert.match(unknown.dimensions.reason, /unit/i);
  const unsupported = await extractMetadata('/tmp/ignored.xyz', 'xyz');
  assert.equal(unsupported.dimensions.status, 'unavailable');
  if (unsupported.dimensions.status === 'unavailable') assert.match(unsupported.dimensions.reason, /unsupported/i);
});

test('nonfinite STL or OBJ coordinates never become a verified measurement', async () => {
  const obj = await extractMetadataFromBuffer(Buffer.from('v 0 0 0\nv Infinity 1 1\nf 1 1 1\n'), 'obj');
  assert.equal(obj.dimensions.status, 'unavailable');
  if (obj.dimensions.status === 'unavailable') assert.match(obj.dimensions.reason, /nonfinite/i);
});
