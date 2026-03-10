const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const THREE = require("three");

function loadTsModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  });

  const mod = new Module.Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(compiled.outputText, filePath);
  return mod.exports;
}

const { prepareStlGeometry } = loadTsModule(
  path.join(__dirname, "../src/renderer/lib/meshPrep.ts"),
);

test("prepareStlGeometry strips color data and recomputes invalid normals", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
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
    "normal",
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ],
      3,
    ),
  );
  geometry.hasColors = true;

  const prepared = prepareStlGeometry(geometry);
  const normals = prepared.getAttribute("normal");

  assert.equal(prepared.hasAttribute("color"), false);
  assert.equal(prepared.hasColors, false);
  assert.deepEqual(Array.from(normals.array), [
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
});
