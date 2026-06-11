import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url && process.env.NEXT_PHASE !== 'phase-production-build') {
  throw new Error('DATABASE_URL is required');
}

export const pool = url ? new Pool({ connectionString: url }) : (null as unknown as Pool);
export const db = url ? drizzle(pool, { schema }) : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);

if (url) {
  // Graceful shutdown so Railway rolling restarts don't leave the previous
  // container's PG connections hanging.
  const shutdown = () => { pool.end().catch(() => {}); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
