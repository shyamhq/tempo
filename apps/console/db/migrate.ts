import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './index';
import { defaultWorkspaceId } from './ids';
import { workspaces } from './schema';

async function main() {
  await migrate(db, { migrationsFolder: './db/migrations' });
  await db
    .insert(workspaces)
    .values({ id: defaultWorkspaceId, name: 'default' })
    .onConflictDoNothing();
  console.log('migrations applied; default workspace seeded');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
