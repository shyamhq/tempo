// Global test preload (see bunfig.toml). @tempo/db/client builds a pg Pool at
// import time and throws without DATABASE_URL, so seed a dummy before any query
// module loads. Unit tests mock the actual data/SDK access — nothing connects.
import { mock } from 'bun:test';
import RedisMock from 'ioredis-mock';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/tempo_test';
// redis.ts requires REDIS_URL at import, and cache.ts (RedisCache) issues real
// GET/SET — back ioredis with an in-memory mock so unit tests need no live
// Redis. The mock doesn't truly block on XREAD; stream delivery is covered by
// manual smoke tests, not unit tests.
process.env.REDIS_URL ??= 'redis://localhost:6379';
mock.module('ioredis', () => ({ default: RedisMock }));
