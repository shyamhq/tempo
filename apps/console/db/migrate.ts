import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main() {
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
