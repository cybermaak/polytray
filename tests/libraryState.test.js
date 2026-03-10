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
  DEFAULT_LIBRARY_STATE,
  LIBRARY_STATE_STORAGE_KEY,
  normalizeLibraryState,
  serializeLibraryState,
  withAddedLibraryFolder,
  withRemovedLibraryFolder,
} = loadTsModule(path.join(__dirname, "../src/shared/libraryState.ts"));

test("normalizeLibraryState deduplicates folders and aligns lastFolder", () => {
  const state = normalizeLibraryState({
    libraryFolders: ["/a", "/a", " ", "/b", 123],
    lastFolder: "/missing",
  });

  assert.deepEqual(state.libraryFolders, ["/a", "/b"]);
  assert.equal(state.lastFolder, "/a");
});

test("library state helpers update folders and lastFolder predictably", () => {
  const added = withAddedLibraryFolder(DEFAULT_LIBRARY_STATE, "/models");
  assert.deepEqual(added.libraryFolders, ["/models"]);
  assert.equal(added.lastFolder, "/models");

  const removed = withRemovedLibraryFolder(added, "/models");
  assert.deepEqual(removed, DEFAULT_LIBRARY_STATE);
});

test("serializeLibraryState writes normalized localStorage payload", () => {
  const payload = serializeLibraryState({
    libraryFolders: ["/models", "/models"],
    lastFolder: "/models",
  });

  assert.equal(typeof payload, "string");
  assert.equal(LIBRARY_STATE_STORAGE_KEY, "polytray-library-state");
  assert.deepEqual(JSON.parse(payload), {
    libraryFolders: ["/models"],
    lastFolder: "/models",
  });
});
