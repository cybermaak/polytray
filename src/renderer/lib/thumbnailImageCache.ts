export const MAX_THUMBNAIL_CACHE_ENTRIES = 128;
export const MAX_THUMBNAIL_CACHE_BYTES = 16 * 1024 * 1024;

export type ThumbnailImageIdentity = string | number;
export type ThumbnailImageReader = (thumbnailPath: string) => Promise<string | null>;

export interface ThumbnailImageCache {
  load(thumbnailPath: string | null | undefined, identity?: ThumbnailImageIdentity): Promise<string | null>;
  invalidate(thumbnailPath?: string): void;
  subscribe(thumbnailPath: string, listener: () => void): () => void;
}

export interface ThumbnailImageCacheOptions {
  maxEntries?: number;
  maxEncodedBytes?: number;
}

interface CachedThumbnail {
  path: string;
  dataUrl: string;
  encodedBytes: number;
}

interface InFlightThumbnail {
  path: string;
  promise: Promise<string | null>;
}

function cacheKey(thumbnailPath: string, identity?: ThumbnailImageIdentity) {
  const stableIdentity = identity === undefined ? null : [typeof identity, String(identity)];
  return JSON.stringify([thumbnailPath, stableIdentity]);
}

function isCachePath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && !/^data:/i.test(value);
}

function isPngDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
}

function finiteLimit(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

export function createThumbnailImageCache(
  readThumbnail: ThumbnailImageReader,
  options: ThumbnailImageCacheOptions = {},
): ThumbnailImageCache {
  const maxEntries = finiteLimit(options.maxEntries, MAX_THUMBNAIL_CACHE_ENTRIES);
  const maxEncodedBytes = finiteLimit(options.maxEncodedBytes, MAX_THUMBNAIL_CACHE_BYTES);
  const completed = new Map<string, CachedThumbnail>();
  const inFlight = new Map<string, InFlightThumbnail>();
  const listenersByPath = new Map<string, Set<() => void>>();
  let encodedBytes = 0;

  function notify(path?: string) {
    const listeners = path === undefined
      ? [...listenersByPath.values()].flatMap((set) => [...set])
      : [...(listenersByPath.get(path) ?? [])];
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[ThumbnailImage] Cache invalidation listener failed:', error);
      }
    }
  }

  function removeCompleted(key: string) {
    const entry = completed.get(key);
    if (!entry) return;
    completed.delete(key);
    encodedBytes -= entry.encodedBytes;
  }

  function store(key: string, path: string, dataUrl: string) {
    const entryBytes = dataUrl.length; // Accepted PNG data URLs are ASCII, so chars equal encoded bytes.
    if (maxEntries === 0 || entryBytes > maxEncodedBytes) return;
    removeCompleted(key);
    completed.set(key, { path, dataUrl, encodedBytes: entryBytes });
    encodedBytes += entryBytes;
    while (completed.size > maxEntries || encodedBytes > maxEncodedBytes) {
      const oldestKey = completed.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      removeCompleted(oldestKey);
    }
  }

  function load(thumbnailPath: string | null | undefined, identity?: ThumbnailImageIdentity) {
    if (!isCachePath(thumbnailPath)) return Promise.resolve(null);
    const key = cacheKey(thumbnailPath, identity);
    const cached = completed.get(key);
    if (cached) {
      completed.delete(key);
      completed.set(key, cached);
      return Promise.resolve(cached.dataUrl);
    }

    const existing = inFlight.get(key);
    if (existing) return existing.promise;

    const request: InFlightThumbnail = { path: thumbnailPath, promise: Promise.resolve(null) };
    request.promise = Promise.resolve()
      .then(() => readThumbnail(thumbnailPath))
      .then((dataUrl) => {
        // Invalidation removes this request from the map. Only its current owner
        // can publish or return the result; a newer request may already exist.
        if (inFlight.get(key) !== request || !isPngDataUrl(dataUrl)) return null;
        store(key, thumbnailPath, dataUrl);
        return dataUrl;
      })
      .catch(() => null)
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request.promise;
  }

  function invalidate(thumbnailPath?: string) {
    for (const [key, entry] of completed) {
      if (thumbnailPath === undefined || entry.path === thumbnailPath) removeCompleted(key);
    }
    for (const [key, request] of inFlight) {
      if (thumbnailPath === undefined || request.path === thumbnailPath) inFlight.delete(key);
    }
    notify(thumbnailPath);
  }

  function subscribe(thumbnailPath: string, listener: () => void) {
    const listeners = listenersByPath.get(thumbnailPath) ?? new Set<() => void>();
    listeners.add(listener);
    listenersByPath.set(thumbnailPath, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
      if (listeners.size === 0) listenersByPath.delete(thumbnailPath);
    };
  }

  return { load, invalidate, subscribe };
}

/** A single reader/cache shared by every thumbnail image in the renderer. */
export const thumbnailImageCache = createThumbnailImageCache((thumbnailPath) => {
  if (typeof window === 'undefined' || !window.polytray) return Promise.resolve(null);
  return window.polytray.readThumbnail(thumbnailPath);
});

/**
 * Connects one mounted image to the shared cache. The returned cleanup is safe
 * to call on unmount or when its path/identity changes.
 */
export function watchThumbnailImage(
  cache: ThumbnailImageCache,
  thumbnailPath: string | null | undefined,
  identity: ThumbnailImageIdentity | undefined,
  onChange: (dataUrl: string | null) => void,
): () => void {
  let active = true;
  let requestGeneration = 0;
  const load = () => {
    const generation = ++requestGeneration;
    void cache.load(thumbnailPath, identity).then((dataUrl) => {
      if (active && generation === requestGeneration) onChange(dataUrl);
    }).catch(() => {
      // Cache reads normalize failures to null; keep this observer defensive.
    });
  };

  onChange(null);
  const unsubscribe = isCachePath(thumbnailPath)
    ? cache.subscribe(thumbnailPath, () => {
      requestGeneration++;
      onChange(null);
      load();
    })
    : () => {};
  load();

  return () => {
    if (!active) return;
    active = false;
    requestGeneration++;
    unsubscribe();
  };
}
