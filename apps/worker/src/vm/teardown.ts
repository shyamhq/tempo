import { db } from '@tempo/db/client';
import { vm_runs } from '@tempo/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { Sandbox } from 'e2b';
import { logger } from '../logger';

export async function teardown({
  sandbox,
  vm_run_id,
  exit_reason,
}: {
  sandbox: Sandbox;
  vm_run_id: string;
  exit_reason: string;
}): Promise<void> {
  try {
    await sandbox.kill();
  } catch (err) {
    // Already gone (e.g. idle wallclock fired) → fine. Anything else → log + continue;
    // the row still needs ended_at.
    logger.warn({ err, vmRunId: vm_run_id }, 'vm: kill failed (already dead?)');
  }
  await db
    .update(vm_runs)
    .set({ ended_at: sql`now()`, exit_reason })
    .where(eq(vm_runs.id, vm_run_id));
  logger.info({ vmRunId: vm_run_id, reason: exit_reason }, 'vm: torn down');
}
