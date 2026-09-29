export type WatcherMutationRunner = <T>(operation: () => T | Promise<T>) => Promise<T>;

/** Start/reconfigure a watcher inside the mutation gate and retain that runner for its DB writes. */
export function startWatcherThroughMutationGate<T>(
  start: (runMutation?: WatcherMutationRunner) => Promise<T>,
  runMutation?: WatcherMutationRunner,
): Promise<T> {
  const operation = () => start(runMutation);
  return runMutation ? runMutation(operation) : operation();
}
