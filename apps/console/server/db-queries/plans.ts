import { db } from '@tempo/db/client';
import { plans, threads } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';

export type PlanRow = {
  status: 'unapproved' | 'approved';
  body_pm_json: string | null;
  updated_at: Date | null;
  updated_by: 'dev' | 'agent' | null;
};

export async function readPlanRow(threadId: string): Promise<PlanRow> {
  const [t] = await db
    .select({ status: threads.status })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  const [row] = await db
    .select({
      body_pm_json: plans.body_pm_json,
      updated_at: plans.updated_at,
      updated_by: plans.updated_by,
    })
    .from(plans)
    .where(eq(plans.thread_id, threadId))
    .limit(1);
  return {
    status: t?.status ?? 'unapproved',
    body_pm_json: row?.body_pm_json ?? null,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}
