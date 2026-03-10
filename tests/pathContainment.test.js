const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

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

const {
  isPathContained,
  filterContainedPaths,
} = loadTsModule(path.join(__dirname, "../src/main/pathContainment.ts"));

test("isPathContained accepts exact and nested descendants only", () => {
  const root = "/library/models";

  assert.equal(isPathContained(root, "/library/models"), true);
  assert.equal(isPathContained(root, "/library/models/part.stl"), true);
  assert.equal(isPathContained(root, "/library/models/nested/part.stl"), true);

  assert.equal(isPathContained(root, "/library/models-archive/part.stl"), false);
  assert.equal(isPathContained(root, "/library/modelsheet/part.stl"), false);
});

test("filterContainedPaths drops sibling-prefix collisions", () => {
  const root = "/library/models";
  const candidates = [
    "/library/models/a.stl",
    "/library/models/nested/b.stl",
    "/library/models-archive/c.stl",
    "/library/modelsheet/d.stl",
  ];

  assert.deepEqual(filterContainedPaths(root, candidates), [
    "/library/models/a.stl",
    "/library/models/nested/b.stl",
  ]);
});
