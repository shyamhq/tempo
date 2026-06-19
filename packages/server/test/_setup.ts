// Global test preload (see bunfig.toml). @tempo/db/client builds a pg Pool at
// import time and throws without DATABASE_URL, so seed a dummy before any query
// module loads. Unit tests mock the actual data/SDK access — nothing connects.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/tempo_test';
