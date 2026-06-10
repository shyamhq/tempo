import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';

async function main() {
  await migrate(db, { migrationsFolder: './db/migrations' });
  console.log('migrations applied');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
