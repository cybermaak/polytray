export interface IsolatedRequestCounters {
  libraryPages: number;
  stats: number;
  directories: number;
}

declare global {
  // Queried only by the isolated Electron test process via ElectronApplication.evaluate.
  var __POLYTRAY_ISOLATED_REQUEST_COUNTS: IsolatedRequestCounters | undefined;
}

function createCounters(): IsolatedRequestCounters | null {
  if (process.env.POLYTRAY_ISOLATED_TEST !== "1") return null;
  const existing = globalThis.__POLYTRAY_ISOLATED_REQUEST_COUNTS;
  if (existing) return existing;
  const counts: IsolatedRequestCounters = { libraryPages: 0, stats: 0, directories: 0 };
  Object.defineProperty(globalThis, "__POLYTRAY_ISOLATED_REQUEST_COUNTS", {
    value: counts,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return counts;
}

const counters = createCounters();

export function countIsolatedRequest(kind: keyof IsolatedRequestCounters): void {
  if (counters) counters[kind] += 1;
}
