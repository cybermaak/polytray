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
  DEFAULT_APP_SETTINGS,
  SETTINGS_STORAGE_KEY,
  normalizeAppSettings,
  serializeAppSettings,
} = loadTsModule(path.join(__dirname, "../src/shared/settings.ts"));

test("normalizeAppSettings falls back to defaults for invalid values", () => {
  const settings = normalizeAppSettings({
    lightMode: true,
    gridSize: "huge",
    autoScan: false,
    watch: "yes",
    showGrid: true,
    thumbQuality: "999",
    accentColor: "blue",
    thumbnail_timeout: -10,
    scanning_batch_size: 0,
    watcher_stability: 999999,
    page_size: 2,
  });

  assert.equal(settings.lightMode, true);
  assert.equal(settings.gridSize, DEFAULT_APP_SETTINGS.gridSize);
  assert.equal(settings.autoScan, false);
  assert.equal(settings.watch, DEFAULT_APP_SETTINGS.watch);
  assert.equal(settings.showGrid, true);
  assert.equal(settings.thumbQuality, DEFAULT_APP_SETTINGS.thumbQuality);
  assert.equal(settings.accentColor, DEFAULT_APP_SETTINGS.accentColor);
  assert.equal(settings.thumbnail_timeout, DEFAULT_APP_SETTINGS.thumbnail_timeout);
  assert.equal(settings.scanning_batch_size, DEFAULT_APP_SETTINGS.scanning_batch_size);
  assert.equal(settings.watcher_stability, DEFAULT_APP_SETTINGS.watcher_stability);
  assert.equal(settings.page_size, DEFAULT_APP_SETTINGS.page_size);
});

test("serializeAppSettings writes a normalized localStorage payload", () => {
  const payload = serializeAppSettings({
    lightMode: true,
    page_size: 2000,
  });

  assert.equal(typeof payload, "string");
  const parsed = JSON.parse(payload);
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(DEFAULT_APP_SETTINGS).sort());
  assert.equal(parsed.page_size, 2000);
  assert.equal(SETTINGS_STORAGE_KEY, "polytray-settings");
});
