const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { execFileSync } = require("node:child_process");

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
  MIGRATIONS,
  LATEST_DB_VERSION,
} = loadTsModule(path.join(__dirname, "../src/main/database.ts"));

function createDbAtVersion(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polytray-migration-"));
  const dbPath = path.join(dir, "polytray.db");

  const statements = [];
  if (version >= 1) {
    statements.push(MIGRATIONS[0].sql);
  }
  if (version >= 2) {
    statements.push(MIGRATIONS[1].sql);
  }
  if (version >= 3) {
    statements.push(MIGRATIONS[2].sql);
  }
  if (version >= 4) {
    statements.push(MIGRATIONS[3].sql);
  }
  statements.push(`PRAGMA user_version = ${version};`);
  execFileSync("sqlite3", [dbPath, statements.join("\n")]);

  return { dbPath, dir };
}

for (const version of [0, 1, 2, 3, 4]) {
  test(`migrations upgrade schema from version ${version} to latest`, () => {
    const { dbPath, dir } = createDbAtVersion(version);
    try {
      const pendingMigrations = MIGRATIONS.filter((migration) => migration.version > version);
      if (pendingMigrations.length > 0) {
        execFileSync(
          "sqlite3",
          [
            dbPath,
            [
              ...pendingMigrations.map((migration) => migration.sql),
              `PRAGMA user_version = ${LATEST_DB_VERSION};`,
            ].join("\n"),
          ],
        );
      }

      const currentVersion = execFileSync(
        "sqlite3",
        [dbPath, "PRAGMA user_version;"],
        { encoding: "utf8" },
      ).trim();
      assert.equal(Number(currentVersion), LATEST_DB_VERSION);

      const columnsRaw = execFileSync(
        "sqlite3",
        [dbPath, "PRAGMA table_info(files);"],
        { encoding: "utf8" },
      );
      const columnNames = columnsRaw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("|")[1]);
      for (const expected of [
        "thumbnail_failed",
        "tags",
        "notes",
        "print_status",
        "dimensions",
      ]) {
        assert.equal(columnNames.includes(expected), true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
