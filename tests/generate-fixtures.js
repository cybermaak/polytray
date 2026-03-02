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
  const triangleCount = 12; // A simple cube = 12 triangles
  const bufferSize = 80 + 4 + triangleCount * 50;
  const buf = Buffer.alloc(bufferSize);

  // Header (80 bytes)
  buf.write("Binary STL test fixture - solid cube", 0, "ascii");

  // Triangle count
  buf.writeUInt32LE(triangleCount, 80);

  const triangles = [
    // z=0 face (normal 0,0,-1)
    [0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 1, 0],
    [0, 0, -1, 0, 0, 0, 1, 1, 0, 1, 0, 0],
    // z=1 face (normal 0,0,1)
    [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1],
    [0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1],
    // x=0 face (normal -1,0,0)
    [-1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1],
    [-1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0],
    // x=1 face (normal 1,0,0)
    [1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1],
    [1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1],
    // y=0 face (normal 0,-1,0)
    [0, -1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1],
    [0, -1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1],
    // y=1 face (normal 0,1,0)
    [0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1],
    [0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0],
  ];

  let offset = 84;
  for (const tri of triangles) {
    // Normal
    buf.writeFloatLE(tri[0], offset);
    buf.writeFloatLE(tri[1], offset + 4);
    buf.writeFloatLE(tri[2], offset + 8);
    // Vertex 1
    buf.writeFloatLE(tri[3], offset + 12);
    buf.writeFloatLE(tri[4], offset + 16);
    buf.writeFloatLE(tri[5], offset + 20);
    // Vertex 2
    buf.writeFloatLE(tri[6], offset + 24);
    buf.writeFloatLE(tri[7], offset + 28);
    buf.writeFloatLE(tri[8], offset + 32);
    // Vertex 3
    buf.writeFloatLE(tri[9], offset + 36);
    buf.writeFloatLE(tri[10], offset + 40);
    buf.writeFloatLE(tri[11], offset + 44);
    // Attribute byte count
    buf.writeUInt16LE(0, offset + 48);
    offset += 50;
  }

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
