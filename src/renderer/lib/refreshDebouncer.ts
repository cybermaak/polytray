interface RefreshDebouncer {
  trigger: () => void;
  flush: () => void;
  cancel: () => void;
}

export function createRefreshDebouncer(
  refresh: () => void,
  delayMs: number,
): RefreshDebouncer {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const flush = () => {
    if (timeoutId === null) {
      return;
    }

    cancel();
    refresh();
  };

  const trigger = () => {
    cancel();
    timeoutId = setTimeout(() => {
      timeoutId = null;
      refresh();
    }, delayMs);
  };

  return {
    trigger,
    flush,
    cancel,
  };
}
