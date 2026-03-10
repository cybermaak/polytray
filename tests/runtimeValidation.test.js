const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

require.extensions[".ts"] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

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
  parseRuntimeSettings,
  parseFolderPath,
  parseThumbnailPath,
  parsePreviewParseRequest,
} = loadTsModule(path.join(__dirname, "../src/main/ipc/runtimeValidation.ts"));

test("parseRuntimeSettings normalizes valid runtime settings", () => {
  assert.deepEqual(
    parseRuntimeSettings({
      thumbnail_timeout: 2500,
      scanning_batch_size: 10,
      watcher_stability: 500,
      page_size: 250,
    }),
    {
      thumbnail_timeout: 2500,
      scanning_batch_size: 10,
      watcher_stability: 500,
      page_size: 250,
    },
  );
});

test("parseRuntimeSettings rejects invalid runtime settings", () => {
  assert.throws(
    () => parseRuntimeSettings({ thumbnail_timeout: "fast" }),
    /Invalid runtime settings/,
  );
});

test("path and preview validators reject malformed IPC payloads", () => {
  assert.equal(parseFolderPath("/models"), "/models");
  assert.equal(parseThumbnailPath("/tmp/thumb.png"), "/tmp/thumb.png");
  assert.deepEqual(
    parsePreviewParseRequest({
      requestId: "abc",
      filePath: "/tmp/model.3mf",
      ext: "3mf",
    }),
    {
      requestId: "abc",
      filePath: "/tmp/model.3mf",
      ext: "3mf",
    },
  );

  assert.throws(() => parseFolderPath(""), /Invalid folder path/);
  assert.throws(() => parseThumbnailPath(42), /Invalid thumbnail path/);
  assert.throws(
    () => parsePreviewParseRequest({ requestId: "abc" }),
    /Invalid preview parse request/,
  );
});
