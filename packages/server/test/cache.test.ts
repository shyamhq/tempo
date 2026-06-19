// The cache is the swap seam for Redis later, so its TTL + load-once semantics
// are the contract worth pinning. Distinct keys per test (the cache is a
// process singleton with no reset) keep cases independent.
import { beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { cache, getOrLoad } from '../src/cache';

beforeEach(() => setSystemTime()); // back to the real clock

describe('cache get/set', () => {
  test('round-trips a value', async () => {
    await cache.set('c_k1', { a: 1 }, 1000);
    expect(await cache.get('c_k1')).toEqual({ a: 1 });
  });

  test('returns undefined for a missing key', async () => {
    expect(await cache.get('c_missing')).toBeUndefined();
  });

  test('an entry expires once past its TTL', async () => {
    setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    await cache.set('c_k2', 'v', 1000); // 1s TTL
    setSystemTime(new Date('2026-01-01T00:00:00.500Z'));
    expect(await cache.get('c_k2')).toBe('v'); // still fresh
    setSystemTime(new Date('2026-01-01T00:00:01.001Z'));
    expect(await cache.get('c_k2')).toBeUndefined(); // expired
  });
});

describe('getOrLoad', () => {
  test('loads once on a miss, then serves repeated calls from cache', async () => {
    const load = mock(async () => 'loaded');
    expect(await getOrLoad('c_g1', 1000, load)).toBe('loaded');
    expect(await getOrLoad('c_g1', 1000, load)).toBe('loaded');
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('reloads after the cached entry expires', async () => {
    setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    let n = 0;
    const load = mock(async () => `v${++n}`);
    expect(await getOrLoad('c_g2', 1000, load)).toBe('v1');
    setSystemTime(new Date('2026-02-01T00:00:02.000Z')); // past TTL
    expect(await getOrLoad('c_g2', 1000, load)).toBe('v2');
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('different keys are cached independently', async () => {
    await getOrLoad('c_g3a', 1000, async () => 'a');
    await getOrLoad('c_g3b', 1000, async () => 'b');
    expect(await cache.get('c_g3a')).toBe('a');
    expect(await cache.get('c_g3b')).toBe('b');
  });
});
