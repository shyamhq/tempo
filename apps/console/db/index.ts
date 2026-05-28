import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

const url = process.env.DATABASE_URL ?? 'file:./data/tempo.db';
if (url.startsWith('file:')) mkdirSync(dirname(url.slice(5)), { recursive: true });

export const db = drizzle(createClient({ url }), { schema });
