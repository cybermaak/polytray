export interface ViewerFrameScheduler {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(frameId: number): void;
  updateControls(): boolean;
  draw(): void;
}

export interface MainWindowVisibilityData {
  visible: boolean;
  revision: number;
}

export function createMainWindowVisibilityGate(onChange: (visible: boolean) => void) {
  let acceptedRevision = -1;
  let currentVisibility = true;
  return (update: MainWindowVisibilityData) => {
    if (!Number.isSafeInteger(update.revision) || update.revision <= acceptedRevision) return false;
    acceptedRevision = update.revision;
    currentVisibility = update.visible;
    onChange(currentVisibility);
    return true;
  };
}

export type ViewerSessionResourceDisposer<TResources> = (
  resources: TResources,
  owner: ViewerSession<TResources>,
) => void;

export function disposeOwnedViewerResources<TResources>(
  owner: ViewerSession<TResources>,
  currentOwner: ViewerSession<TResources> | null,
  resources: TResources,
  disposeResources: (resources: TResources, ownsCurrentUi: boolean) => void,
  clearCurrentOwner: () => void,
) {
  const ownsCurrentUi = currentOwner === owner;
  try {
    disposeResources(resources, ownsCurrentUi);
  } finally {
    if (ownsCurrentUi) clearCurrentOwner();
  }
}

/** Owns one viewer's resources, render scheduling, cleanup, and async load generation. */
export class ViewerSession<TResources> {
  private frameId: number | null = null;
  private deferredFrames = new Map<number, () => void>();
  private cleanups = new Set<() => void>();
  private loadToken = 0;
  private disposed = false;
  private visible = true;

  constructor(
    readonly resources: TResources,
    private readonly scheduler: ViewerFrameScheduler,
    private readonly disposeResources?: ViewerSessionResourceDisposer<TResources>,
  ) {}

  get isDisposed() {
    return this.disposed;
  }

  get hasPendingFrame() {
    return this.frameId !== null;
  }

  beginLoad() {
    if (this.disposed) return this.loadToken;
    return ++this.loadToken;
  }

  isCurrent(token: number) {
    return !this.disposed && token === this.loadToken;
  }

  addCleanup(cleanup: () => void) {
    if (this.disposed) {
      cleanup();
      return () => {};
    }
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  yieldToFrame(signal?: AbortSignal) {
    if (this.disposed || signal?.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let frameId = 0;
      let settled = false;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const finish = () => {
        if (settled) return;
        settled = true;
        this.deferredFrames.delete(frameId);
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        this.scheduler.cancelFrame(frameId);
        finish();
      };
      frameId = this.scheduler.requestFrame(finish);
      this.deferredFrames.set(frameId, finish);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.cancelPendingFrame();
      return;
    }
    this.invalidate();
  }

  invalidate() {
    if (this.disposed || !this.visible || this.frameId !== null) return;
    this.frameId = this.scheduler.requestFrame(this.renderFrame);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken++;
    this.cancelPendingFrame();
    for (const [frameId, resolve] of this.deferredFrames) {
      this.scheduler.cancelFrame(frameId);
      resolve();
    }
    this.deferredFrames.clear();
    for (const cleanup of [...this.cleanups].reverse()) {
      this.cleanups.delete(cleanup);
      try {
        cleanup();
      } catch (error) {
        console.warn("Viewer session cleanup failed", error);
      }
    }
    try {
      this.disposeResources?.(this.resources, this);
    } catch (error) {
      console.warn("Viewer resource disposal failed", error);
    }
  }

  private cancelPendingFrame() {
    if (this.frameId === null) return;
    this.scheduler.cancelFrame(this.frameId);
    this.frameId = null;
  }

  private renderFrame: FrameRequestCallback = () => {
    this.frameId = null;
    if (this.disposed || !this.visible) return;
    const controlsMoving = this.scheduler.updateControls();
    this.scheduler.draw();
    if (controlsMoving) this.invalidate();
  };
}
