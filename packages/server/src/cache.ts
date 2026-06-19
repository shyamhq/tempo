// Process-wide cache for slow-changing remote lookups (e.g. a connector's
// action catalog). In-memory today; the interface is async ON PURPOSE so that
// swapping the implementation for a Redis-backed one later is a single change
// in this file — `export const cache = new MemoryCache()` becomes
// `new RedisCache(...)` — with zero churn at any call site.

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

class MemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

// The single swap point. Replace MemoryCache with a Redis-backed Cache here.
export const cache: Cache = new MemoryCache();

// The common pattern: return the cached value, or load it, store it, and return
// it on a miss. A loader that returns `undefined` is treated as "nothing to
// cache" and runs every call — fine for our lookups, which always return a value.
export async function getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await cache.set(key, value, ttlMs);
  return value;
}
