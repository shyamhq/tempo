// Redis-backed cache for slow-changing remote lookups (e.g. a connector's
// action catalog). Uses the one shared Redis connection. Async on purpose so
// call sites stay identical to the previous in-memory version.

import { redis } from './redis';

const CACHE_PREFIX = 'tempo:cache:';

export const cache = {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = await redis().get(CACHE_PREFIX + key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined; // corrupt entry → treat as a miss and reload
    }
  },

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await redis().set(CACHE_PREFIX + key, JSON.stringify(value), 'PX', ttlMs);
  },
};

// Return the cached value, or load it, store it, and return it on a miss. A
// loader that returns `undefined` is treated as "nothing to cache" and runs
// every call — fine for our lookups, which always return a value.
export async function getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await cache.set(key, value, ttlMs);
  return value;
}
