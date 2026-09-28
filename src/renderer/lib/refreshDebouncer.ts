interface RefreshDebouncer {
  trigger: (targets?: RefreshTargets) => void;
  flush: () => void;
  cancel: () => void;
}

export interface RefreshTargets {
  pages: boolean;
  stats: boolean;
  topology: boolean;
}

const ALL_REFRESH_TARGETS: RefreshTargets = { pages: true, stats: true, topology: true };

export function createRefreshDebouncer(
  refresh: (targets: RefreshTargets) => void,
  delayMs: number,
): RefreshDebouncer {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingTargets: RefreshTargets | null = null;

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    pendingTargets = null;
  };

  const flush = () => {
    if (timeoutId === null) {
      return;
    }

    const targets = pendingTargets;
    cancel();
    if (targets) refresh(targets);
  };

  const trigger = (targets: RefreshTargets = ALL_REFRESH_TARGETS) => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    pendingTargets = pendingTargets
      ? {
          pages: pendingTargets.pages || targets.pages,
          stats: pendingTargets.stats || targets.stats,
          topology: pendingTargets.topology || targets.topology,
        }
      : { ...targets };
    timeoutId = setTimeout(() => {
      timeoutId = null;
      const pending = pendingTargets;
      pendingTargets = null;
      if (pending) refresh(pending);
    }, delayMs);
  };

  return {
    trigger,
    flush,
    cancel,
  };
}
