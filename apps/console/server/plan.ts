import type { Actor, Plan } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { plans, threads } from '../db/schema';
import { reconcileCommentAnchors } from './comments';
import { appendEvent } from './event-log';
import { nowIso, toIso } from './threads';

export async function getPlan(threadId: string): Promise<Plan> {
  const [t] = await db
    .select({ status: threads.status })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  const [p] = await db
    .select({
      body_markdown: plans.body_markdown,
      updated_at: plans.updated_at,
      updated_by: plans.updated_by,
    })
    .from(plans)
    .where(eq(plans.thread_id, threadId))
    .limit(1);
  const status = t?.status ?? 'unapproved';
  if (!p || p.body_markdown == null || p.updated_at == null || p.updated_by == null) {
    return { status, body: null };
  }
  return {
    status,
    body: {
      markdown: p.body_markdown,
      updated_at: toIso(p.updated_at),
      updated_by: p.updated_by,
    },
  };
}

export async function writePlan(
  threadId: string,
  markdown: string,
  by: Actor,
): Promise<{ updated_at: string }> {
  const updated_at = nowIso();
  await db
    .update(plans)
    .set({ body_markdown: markdown, updated_by: by, updated_at })
    .where(eq(plans.thread_id, threadId));
  await db.update(threads).set({ updated_at }).where(eq(threads.id, threadId));
  await reconcileCommentAnchors(threadId, markdown);
  await appendEvent(threadId, {
    kind: by === 'dev' ? 'plan_edited_by_dev' : 'plan_edited_by_agent',
    updated_at,
  });
  return { updated_at };
}
