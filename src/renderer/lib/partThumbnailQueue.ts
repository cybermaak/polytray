export interface PartThumbnailRequest<T> {
  key: string;
  value: T;
}

interface QueueOptions<T> {
  render: (value: T, signal: AbortSignal) => Promise<string>;
  yieldControl: () => Promise<void>;
  maxCache?: number;
  maxPending?: number;
  release?: (url: string) => void;
}

interface Pending<T> {
  token: number;
  request: PartThumbnailRequest<T>;
  isCurrent: () => boolean;
  publish: (key: string, url: string | null, acknowledgeRelease?: () => void, releasedUrl?: string) => void;
}

interface CachedPartThumbnail {
  url: string;
  publish: Pending<unknown>["publish"];
}

/** One-at-a-time thumbnail work with token cancellation and a bounded LRU URL cache. */
export class PartThumbnailQueue<T> {
  private readonly maxCache: number;
  private readonly maxPending: number;
  private readonly cache = new Map<string, CachedPartThumbnail>();
  private readonly pendingReleases = new Map<string, { key: string; url: string }>();
  private pending: Pending<T>[] = [];
  private controller: AbortController | null = null;
  private activeToken: number | null = null;
  private currentToken: number | null = null;
  private pumping = false;
  private disposed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: QueueOptions<T>) {
    this.maxCache = Math.max(1, options.maxCache ?? 64);
    this.maxPending = Math.max(1, options.maxPending ?? 64);
  }

  get cacheSize() { return this.cache.size; }
  get pendingCount() { return this.pending.length; }

  replace(token: number) {
    if (this.disposed) return;
    this.cancelActiveAndPending();
    this.clearCache();
    this.currentToken = token;
  }

  request(
    token: number,
    requests: PartThumbnailRequest<T>[],
    isCurrent: () => boolean,
    publish: (key: string, url: string | null, acknowledgeRelease?: () => void, releasedUrl?: string) => void,
  ) {
    if (this.disposed || token !== this.currentToken || !isCurrent()) return;
    for (const request of requests) {
      const cached = this.cache.get(request.key);
      if (cached) {
        this.cache.delete(request.key);
        this.cache.set(request.key, cached);
        publish(request.key, cached.url);
      } else if (!this.pending.some((item) => item.token === token && item.request.key === request.key)
        && !(this.activeToken === token && this.activeKey === request.key)) {
        if (this.pending.length >= this.maxPending) this.pending.shift();
        this.pending.push({ token, request, isCurrent, publish });
      }
    }
    this.startPump();
  }

  private activeKey: string | null = null;

  cancel() {
    this.cancelActiveAndPending();
    this.currentToken = null;
    this.clearCache();
  }

  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }

  whenIdle() {
    if (!this.pumping && this.pending.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private cancelActiveAndPending() {
    this.pending = [];
    this.controller?.abort();
    this.controller = null;
    this.activeToken = null;
    this.activeKey = null;
  }

  private clearCache() {
    for (const [key, entry] of this.cache) {
      this.releaseAfterRemoval(key, entry);
    }
    this.cache.clear();
  }

  private releaseAfterRemoval(key: string, entry: CachedPartThumbnail) {
    this.pendingReleases.set(entry.url, { key, url: entry.url });
    entry.publish(key, null, () => {
      if (!this.pendingReleases.delete(entry.url)) return;
      this.options.release?.(entry.url);
    }, entry.url);
  }

  private startPump() {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    void this.pump();
  }

  private async pump() {
    try {
      while (!this.disposed && this.pending.length) {
        const job = this.pending.shift()!;
        if (job.token !== this.currentToken || !job.isCurrent()) continue;
        const controller = new AbortController();
        this.controller = controller;
        this.activeToken = job.token;
        this.activeKey = job.request.key;
        try {
          const url = await this.options.render(job.request.value, controller.signal);
          if (controller.signal.aborted || this.disposed || job.token !== this.currentToken || !job.isCurrent()) {
            this.options.release?.(url);
          } else {
            this.cache.set(job.request.key, { url, publish: job.publish });
            while (this.cache.size > this.maxCache) {
              const oldest = this.cache.keys().next().value as string | undefined;
              if (oldest === undefined) break;
              const evicted = this.cache.get(oldest);
              this.cache.delete(oldest);
              if (evicted) this.releaseAfterRemoval(oldest, evicted);
            }
            job.publish(job.request.key, url);
          }
        } catch (error) {
          if (!controller.signal.aborted) console.warn("Part thumbnail render failed", error);
        } finally {
          if (this.controller === controller) this.controller = null;
          if (this.activeToken === job.token && this.activeKey === job.request.key) {
            this.activeToken = null;
            this.activeKey = null;
          }
        }
        if (!this.disposed && this.pending.length) await this.options.yieldControl();
      }
    } finally {
      this.pumping = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
      if (this.pending.length && !this.disposed) this.startPump();
    }
  }
}
