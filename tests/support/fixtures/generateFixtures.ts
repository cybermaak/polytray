import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const fixtureDir = __dirname;
fs.mkdirSync(fixtureDir, { recursive: true });

function createBinaryStl(filename: string) {
  const triangleCount = 12;
  const bufferSize = 80 + 4 + triangleCount * 50;
  const buf = Buffer.alloc(bufferSize);

  buf.write('Binary STL test fixture - solid cube', 0, 'ascii');
  buf.writeUInt32LE(triangleCount, 80);

  const triangles = [
    [0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 1, 0],
    [0, 0, -1, 0, 0, 0, 1, 1, 0, 1, 0, 0],
    [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1],
    [0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1],
    [-1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1],
    [-1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0],
    [1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1],
    [1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1],
    [0, -1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1],
    [0, -1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1],
    [0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0],
  ];

  let offset = 84;
  for (const tri of triangles) {
    buf.writeFloatLE(tri[0], offset);
    buf.writeFloatLE(tri[1], offset + 4);
    buf.writeFloatLE(tri[2], offset + 8);
    buf.writeFloatLE(tri[3], offset + 12);
    buf.writeFloatLE(tri[4], offset + 16);
    buf.writeFloatLE(tri[5], offset + 20);
    buf.writeFloatLE(tri[6], offset + 24);
    buf.writeFloatLE(tri[7], offset + 28);
    buf.writeFloatLE(tri[8], offset + 32);
    buf.writeFloatLE(tri[9], offset + 36);
    buf.writeFloatLE(tri[10], offset + 40);
    buf.writeFloatLE(tri[11], offset + 44);
    buf.writeUInt16LE(0, offset + 48);
    offset += 50;
  }

  fs.writeFileSync(path.join(fixtureDir, filename), buf);
  console.log(`  Created ${filename} (${buf.length} bytes, ${triangleCount} triangles)`);
}

function createObj(filename: string) {
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
  fs.writeFileSync(path.join(fixtureDir, filename), obj, 'utf8');
  console.log(`  Created ${filename}`);
}

async function createZipArchive(filename: string) {
  const zip = new JSZip();
  zip.file('bundle/zip_preview.stl', fs.readFileSync(path.join(fixtureDir, 'test_model_a.stl')));
  zip.file('bundle/zip_compare.obj', fs.readFileSync(path.join(fixtureDir, 'test_cube.obj')));
  const archivePath = path.join(fixtureDir, filename);
  fs.writeFileSync(archivePath, await zip.generateAsync({ type: 'nodebuffer' }));
  console.log(`  Created ${filename}`);
}

async function main() {
  console.log('Generating test fixtures...');
  createBinaryStl('test_square.stl');
  createBinaryStl('test_model_a.stl');
  createBinaryStl('test_model_b.stl');
  createObj('test_cube.obj');
  await createZipArchive('test_bundle.zip');
  console.log('Done!');
}

void main();
