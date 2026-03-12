const test = require("node:test");
const assert = require("node:assert/strict");

const { buildElectronLaunchEnv } = require("./helpers/electronLaunch");

test("buildElectronLaunchEnv removes ELECTRON_RUN_AS_NODE from inherited env", () => {
  const env = buildElectronLaunchEnv({
    PATH: "/tmp/bin",
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_USER_DATA: "/tmp/original",
  }, {
    ELECTRON_USER_DATA: "/tmp/test-user-data",
  });

  assert.equal("ELECTRON_RUN_AS_NODE" in env, false);
  assert.equal(env.PATH, "/tmp/bin");
  assert.equal(env.ELECTRON_USER_DATA, "/tmp/test-user-data");
});
