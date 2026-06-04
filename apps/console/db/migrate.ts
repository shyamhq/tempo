import { migrate } from 'drizzle-orm/libsql/migrator';
import { defaultWorkspaceId } from './ids';
import { db } from './index';
import { workspaces } from './schema';

async function main() {
  await migrate(db, { migrationsFolder: './db/migrations' });
  // Migration 0006 also seeds the default workspace + General Space; this
  // insert is a safety net for fresh installs that for any reason skip 0006.
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
