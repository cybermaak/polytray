function buildElectronLaunchEnv(baseEnv, overrides = {}) {
  const env = {
    ...baseEnv,
    ...overrides,
  };

  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

module.exports = {
  buildElectronLaunchEnv,
};
