export function subscribeToRestoreStatusRefresh<T>(
  subscribe: (listener: (mutation: T) => void) => () => void,
  refreshStatus: () => unknown,
): () => void {
  return subscribe(() => { void refreshStatus(); });
}
