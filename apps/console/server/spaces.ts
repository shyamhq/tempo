import type { Space, SpaceThreadLite } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import {
  comments,
  discussion_messages,
  events,
  plans,
  replies,
  sessions,
  spaces,
  threads,
} from '@tempo/db/schema';
import { newSpaceId } from '@tempo/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { cache } from 'react';

// React.cache so the root layout + the home page share one DB hit per request.
export const listSpaces = cache(async (workspaceId: string): Promise<Space[]> => {
  const rows = await db
    .select({
      id: spaces.id,
      name: spaces.name,
      sort_order: spaces.sort_order,
      thread_count: sql<number>`count(${threads.id})`,
    })
    .from(spaces)
    .leftJoin(threads, eq(threads.space_id, spaces.id))
    .where(eq(spaces.workspace_id, workspaceId))
    .groupBy(spaces.id)
    .orderBy(asc(spaces.sort_order), asc(spaces.created_at));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sort_order: r.sort_order,
    thread_count: Number(r.thread_count),
  }));
});

export async function createSpace(name: string, workspaceId: string): Promise<Space> {
  const id = newSpaceId();
  const sort_order = await db.transaction(async (tx) => {
    const [tail] = await tx
      .select({ max: sql<number>`coalesce(max(${spaces.sort_order}), 0)` })
      .from(spaces)
      .where(eq(spaces.workspace_id, workspaceId));
    const next = (tail?.max ?? 0) + 1;
    await tx.insert(spaces).values({ id, workspace_id: workspaceId, name, sort_order: next });
    return next;
  });
  return { id, name, sort_order, thread_count: 0 };
}

export async function updateSpace(
  spaceId: string,
  patch: { name?: string; sort_order?: number },
  workspaceId: string,
): Promise<void> {
  const set: Record<string, string | number> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.sort_order !== undefined) set.sort_order = patch.sort_order;
  const rows = await db
    .update(spaces)
    .set(set)
    .where(and(eq(spaces.id, spaceId), eq(spaces.workspace_id, workspaceId)))
    .returning({ id: spaces.id });
  if (rows.length === 0) throw new Error('space_not_found');
}

// SQLite FKs are unenforced in this repo (AGENTS.md → Spotted but not fixed)
// and the schema has no ON DELETE CASCADE, so we walk the same chain that
// deleteThread(threads.ts) walks per-Thread, but bulk-keyed by space.
export async function deleteSpace(spaceId: string, workspaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [sp] = await tx
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.workspace_id, workspaceId)))
      .limit(1);
    if (!sp) throw new Error('space_not_found');

    const threadRows = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.space_id, spaceId));
    const threadIds = threadRows.map((t) => t.id);

    if (threadIds.length > 0) {
      const commentRows = await tx
        .select({ id: comments.id })
        .from(comments)
        .where(inArray(comments.thread_id, threadIds));
      const commentIds = commentRows.map((c) => c.id);
      if (commentIds.length > 0) {
        await tx.delete(replies).where(inArray(replies.comment_id, commentIds));
      }
      await tx.delete(comments).where(inArray(comments.thread_id, threadIds));
      await tx.delete(discussion_messages).where(inArray(discussion_messages.thread_id, threadIds));
      await tx.delete(events).where(inArray(events.thread_id, threadIds));
      await tx.delete(sessions).where(inArray(sessions.thread_id, threadIds));
      await tx.delete(plans).where(inArray(plans.thread_id, threadIds));
      await tx.delete(threads).where(inArray(threads.id, threadIds));
    }
    await tx.delete(spaces).where(eq(spaces.id, spaceId));
  });
}

export async function listSpaceThreadsLite(
  spaceId: string,
  workspaceId: string,
): Promise<SpaceThreadLite[]> {
  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      status: threads.status,
      sort_order: threads.sort_order,
    })
    .from(threads)
    .innerJoin(spaces, eq(threads.space_id, spaces.id))
    .where(and(eq(threads.space_id, spaceId), eq(spaces.workspace_id, workspaceId)))
    .orderBy(asc(threads.sort_order), asc(threads.created_at));
  return rows;
}
