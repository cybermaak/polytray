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
      jsx: ts.JsxEmit.ReactJSX,
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

test("shared icon set exports the v1.1 toolbar and preview glyphs", () => {
  const { ICON_PATHS } = loadTsModule(
    path.join(__dirname, "../src/renderer/components/iconPaths.ts"),
  );

  assert.deepEqual(
    Object.keys(ICON_PATHS).sort(),
    [
      "close",
      "expand",
      "preview",
      "rescan",
      "settings",
      "sortOrder",
      "theme",
      "thumbnailRefresh",
      "wireframe",
    ].sort(),
  );

  assert.ok(Array.isArray(ICON_PATHS.settings));
  assert.ok(ICON_PATHS.settings.length >= 2);
});
