export function buildElectronLaunchEnv(
  baseEnv: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...overrides,
  };

  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
