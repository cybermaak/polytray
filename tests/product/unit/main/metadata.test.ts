import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { extractMetadata } from "../../../../src/main/metadata";

const fixtureDir = path.resolve(process.cwd(), "tests/support/fixtures");

test("extractMetadata includes dimensions for binary STL fixtures", async () => {
  const metadata = await extractMetadata(
    path.join(fixtureDir, "test_model_a.stl"),
    "stl",
  );

  assert.equal(metadata.vertexCount, 36);
  assert.equal(metadata.faceCount, 12);
  assert.deepEqual(metadata.dimensions, { x: 1, y: 1, z: 1 });
});

test("extractMetadata includes dimensions for OBJ fixtures", async () => {
  const metadata = await extractMetadata(
    path.join(fixtureDir, "test_cube.obj"),
    "obj",
  );

  assert.equal(metadata.vertexCount, 8);
  assert.equal(metadata.faceCount, 6);
  assert.deepEqual(metadata.dimensions, { x: 1, y: 1, z: 1 });
});

test("extractMetadata rejects truncated binary STL input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-metadata-invalid-"));
  const filePath = path.join(dir, "truncated.stl");
  const data = Buffer.alloc(84);
  data.write("binary STL", 0, "ascii");
  data.writeUInt32LE(2, 80);
  fs.writeFileSync(filePath, data);
  try {
    await assert.rejects(extractMetadata(filePath, "stl"), /truncated|malformed/i);
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
    assert.deepEqual(result.dimensions, { x: 29_999, y: 0, z: 0 });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(extractMetadata(emptyPath, "obj", { signal: controller.signal }), /cancel/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
