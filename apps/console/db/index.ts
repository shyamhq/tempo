import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

export const pool = new Pool({ connectionString: url });
export const db = drizzle(pool, { schema });

// Graceful shutdown so Railway rolling restarts don't leave the previous
// container's PG connections hanging — server-side slots stay claimed until
// idle timeout otherwise, racing the new container for the connection limit.
const shutdown = () => {
  pool.end().catch(() => {});
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
