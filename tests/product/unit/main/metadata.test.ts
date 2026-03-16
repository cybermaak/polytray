import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

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
