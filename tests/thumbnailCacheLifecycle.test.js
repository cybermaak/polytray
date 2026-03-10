const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
  THUMBNAIL_CACHE_VERSION,
  reconcileThumbnailCache,
} = loadTsModule(path.join(__dirname, "../src/main/thumbnailCacheLifecycle.ts"));

test("thumbnail cache lifecycle prunes orphaned files and rewrites stale cache versions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-thumb-cache-"));

  try {
    fs.writeFileSync(path.join(dir, "keep.png"), "keep");
    fs.writeFileSync(path.join(dir, "orphan.png"), "orphan");
    fs.writeFileSync(
      path.join(dir, "cache-meta.json"),
      JSON.stringify({ version: THUMBNAIL_CACHE_VERSION - 1 }),
    );

    const result = await reconcileThumbnailCache({
      thumbnailDir: dir,
      referencedThumbnailPaths: [path.join(dir, "keep.png")],
    });

    assert.equal(result.versionReset, true);
    assert.equal(fs.existsSync(path.join(dir, "orphan.png")), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, "cache-meta.json"), "utf8")).version,
      THUMBNAIL_CACHE_VERSION,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
