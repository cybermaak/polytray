/**
 * generate-fixtures.js — Creates minimal valid 3D model files for E2E tests.
 *
 * Run with: node tests/generate-fixtures.js
 */

const fs = require("fs");
const path = require("path");

const FIXTURE_DIR = path.join(__dirname, "fixtures");
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

// ── Binary STL (single triangle) ──────────────────────────────────
function createBinarySTL(filename) {
  // Binary STL format:
  //   80-byte header
  //   4-byte uint32 triangle count
  //   Per triangle: 12 floats (normal + 3 vertices) + 2-byte attribute
  const triangleCount = 2; // A simple square = 2 triangles
  const bufferSize = 80 + 4 + triangleCount * 50;
  const buf = Buffer.alloc(bufferSize);

  // Header (80 bytes)
  buf.write("Binary STL test fixture", 0, "ascii");

  // Triangle count
  buf.writeUInt32LE(triangleCount, 80);

  // Triangle 1: (0,0,0) (1,0,0) (1,1,0) — normal (0,0,1)
  let offset = 84;
  // Normal
  buf.writeFloatLE(0, offset);
  buf.writeFloatLE(0, offset + 4);
  buf.writeFloatLE(1, offset + 8);
  // Vertex 1
  buf.writeFloatLE(0, offset + 12);
  buf.writeFloatLE(0, offset + 16);
  buf.writeFloatLE(0, offset + 20);
  // Vertex 2
  buf.writeFloatLE(1, offset + 24);
  buf.writeFloatLE(0, offset + 28);
  buf.writeFloatLE(0, offset + 32);
  // Vertex 3
  buf.writeFloatLE(1, offset + 36);
  buf.writeFloatLE(1, offset + 40);
  buf.writeFloatLE(0, offset + 44);
  // Attribute byte count
  buf.writeUInt16LE(0, offset + 48);

  // Triangle 2: (0,0,0) (1,1,0) (0,1,0) — normal (0,0,1)
  offset = 84 + 50;
  buf.writeFloatLE(0, offset);
  buf.writeFloatLE(0, offset + 4);
  buf.writeFloatLE(1, offset + 8);
  buf.writeFloatLE(0, offset + 12);
  buf.writeFloatLE(0, offset + 16);
  buf.writeFloatLE(0, offset + 20);
  buf.writeFloatLE(1, offset + 24);
  buf.writeFloatLE(1, offset + 28);
  buf.writeFloatLE(0, offset + 32);
  buf.writeFloatLE(0, offset + 36);
  buf.writeFloatLE(1, offset + 40);
  buf.writeFloatLE(0, offset + 44);
  buf.writeUInt16LE(0, offset + 48);

  fs.writeFileSync(path.join(FIXTURE_DIR, filename), buf);
  console.log(
    `  Created ${filename} (${buf.length} bytes, ${triangleCount} triangles)`,
  );
}

// ── ASCII OBJ (simple cube) ───────────────────────────────────────
function createOBJ(filename) {
  const obj = `# Test cube OBJ
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;
  fs.writeFileSync(path.join(FIXTURE_DIR, filename), obj, "utf-8");
  console.log(`  Created ${filename}`);
}

// Generate fixtures
console.log("Generating test fixtures...");
createBinarySTL("test_square.stl");
createBinarySTL("test_model_a.stl");
createBinarySTL("test_model_b.stl");
createOBJ("test_cube.obj");
console.log("Done!");
