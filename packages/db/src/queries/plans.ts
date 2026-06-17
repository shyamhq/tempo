import { db } from '@tempo/db/client';
import { plans } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';

export type PlanRow = {
  body_pm_json: string | null;
  updated_at: Date | null;
  // NULL = Agent edit; non-null = Clerk user id of the Dev who last wrote.
  updated_by_user_id: string | null;
};

export async function readPlanRow(threadId: string): Promise<PlanRow> {
  const [row] = await db
    .select({
      body_pm_json: plans.body_pm_json,
      updated_at: plans.updated_at,
      updated_by_user_id: plans.updated_by_user_id,
    })
    .from(plans)
    .where(eq(plans.thread_id, threadId))
    .limit(1);
  return {
    body_pm_json: row?.body_pm_json ?? null,
    updated_at: row?.updated_at ?? null,
    updated_by_user_id: row?.updated_by_user_id ?? null,
  };
}
