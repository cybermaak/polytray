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
  createThumbnailJobScheduler,
} = loadTsModule(path.join(__dirname, "../src/main/thumbnailJobScheduler.ts"));

test("thumbnail scheduler dedupes jobs by file path and runs single-flight", async () => {
  const calls = [];
  const scheduler = createThumbnailJobScheduler({
    async execute(job) {
      calls.push(job.filePath);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${job.filePath}.png`;
    },
  });

  const [a, b] = await Promise.all([
    scheduler.enqueue({
      filePath: "/models/cube.stl",
      ext: "stl",
      settings: { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100 },
      source: "scan",
    }),
    scheduler.enqueue({
      filePath: "/models/cube.stl",
      ext: "stl",
      settings: { thumbnail_timeout: 1000, scanning_batch_size: 10, watcher_stability: 500, page_size: 100 },
      source: "watch",
    }),
  ]);

  assert.equal(a, "/models/cube.stl.png");
  assert.equal(b, "/models/cube.stl.png");
  assert.deepEqual(calls, ["/models/cube.stl"]);
});
