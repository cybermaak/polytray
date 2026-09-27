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

/** Build the app arguments for an isolated launch, avoiding macOS saved-window restore prompts. */
export function buildElectronLaunchArgs(
  mainEntry: string,
  userDataDir: string,
  extraArgs: string[] = [],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const macPersistenceArgs = platform === 'darwin' ? ['-ApplePersistenceIgnoreState', 'YES'] : [];
  return [mainEntry, `--user-data-dir=${userDataDir}`, ...extraArgs, ...macPersistenceArgs];
}
