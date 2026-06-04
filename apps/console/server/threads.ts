import { randomBytes } from 'node:crypto';
import type { ThreadSummary } from '@tempo/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { defaultWorkspaceId } from '../db/ids';
import {
  comments,
  discussion_messages,
  events,
  plans,
  replies,
  sessions,
  spaces,
  threads,
} from '../db/schema';
import { newPlanId, newThreadId } from './ids';

export async function createThread(
  workspaceId: string,
  spaceId: string,
  title: string,
  description: string,
): Promise<{ thread: ThreadSummary; connect_token: string }> {
  // 24 random bytes = 32 url-safe base64 chars (no padding).
  const token = `tmp_${randomBytes(24).toString('base64url')}`;
  const id = newThreadId();
  await db.transaction(async (tx) => {
    const [tail] = await tx
      .select({ max: sql<number>`coalesce(max(${threads.sort_order}), 0)` })
      .from(threads)
      .where(eq(threads.space_id, spaceId));
    const sort_order = (tail?.max ?? 0) + 1;
    await tx.insert(threads).values({
      id,
      workspace_id: workspaceId,
      space_id: spaceId,
      title,
      description,
      connect_token: token,
      sort_order,
    });
    await tx.insert(plans).values({ id: newPlanId(), thread_id: id });
  });
  return { thread: { id, title, description }, connect_token: token };
}

export async function getConnectToken(threadId: string): Promise<{ connect_token: string }> {
  const [row] = await db
    .select({ connect_token: threads.connect_token })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) throw new Error('thread_not_found');
  return { connect_token: row.connect_token };
}

export async function listThreads(workspaceId: string = defaultWorkspaceId, spaceId?: string) {
  const where = spaceId
    ? and(eq(threads.workspace_id, workspaceId), eq(threads.space_id, spaceId))
    : eq(threads.workspace_id, workspaceId);
  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      description: threads.description,
      status: threads.status,
      updated_at: threads.updated_at,
    })
    .from(threads)
    .where(where)
    .orderBy(desc(threads.updated_at));

  const out = [];
  for (const t of rows) {
    const [s] = await db
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.thread_id, t.id))
      .orderBy(desc(sessions.created_at))
      .limit(1);
    out.push({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      session_status: s?.status ?? 'pending',
      updated_at: toIso(t.updated_at),
    });
  }
  return out;
}

export async function getThread(threadId: string) {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  return row ?? null;
}

export async function approveThread(threadId: string) {
  await db
    .update(threads)
    .set({ status: 'approved', updated_at: nowIso() })
    .where(eq(threads.id, threadId));
}

export async function deleteThread(threadId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (!t) throw new Error('thread_not_found');

    const commentRows = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.thread_id, threadId));
    const commentIds = commentRows.map((c) => c.id);
    if (commentIds.length > 0) {
      await tx.delete(replies).where(inArray(replies.comment_id, commentIds));
    }
    await tx.delete(comments).where(eq(comments.thread_id, threadId));
    await tx.delete(discussion_messages).where(eq(discussion_messages.thread_id, threadId));
    await tx.delete(events).where(eq(events.thread_id, threadId));
    await tx.delete(sessions).where(eq(sessions.thread_id, threadId));
    await tx.delete(plans).where(eq(plans.thread_id, threadId));
    await tx.delete(threads).where(eq(threads.id, threadId));
  });
}

// Single mutation for title and/or space_id so the route handler doesn't have
// to orchestrate two server calls. Both fields are optional but the caller
// (validated upstream by `UpdateThreadRequest`) must supply at least one.
// When `space_id` is present, we guard inside the transaction that the target
// Space belongs to the same workspace — a forged PATCH must not re-parent a
// Thread under a foreign workspace's Space.
export async function updateThread(
  threadId: string,
  patch: { title?: string; space_id?: string; sort_order?: number },
): Promise<ThreadSummary> {
  return await db.transaction(async (tx) => {
    const [t] = await tx
      .select({
        id: threads.id,
        title: threads.title,
        description: threads.description,
        workspace_id: threads.workspace_id,
      })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (!t) throw new Error('thread_not_found');

    if (patch.space_id) {
      const [sp] = await tx
        .select({ id: spaces.id })
        .from(spaces)
        .where(and(eq(spaces.id, patch.space_id), eq(spaces.workspace_id, t.workspace_id)))
        .limit(1);
      if (!sp) throw new Error('space_workspace_mismatch');
    }

    const set: Record<string, string | number> = { updated_at: nowIso() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.space_id !== undefined) set.space_id = patch.space_id;
    if (patch.sort_order !== undefined) set.sort_order = patch.sort_order;
    await tx.update(threads).set(set).where(eq(threads.id, threadId));

    return {
      id: t.id,
      title: patch.title ?? t.title,
      description: t.description,
    };
  });
}

export async function reopenThread(threadId: string) {
  await db
    .update(threads)
    .set({ status: 'unapproved', updated_at: nowIso() })
    .where(eq(threads.id, threadId));
}

export async function latestSessionStatus(threadId: string) {
  const [s] = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.thread_id, threadId))
    .orderBy(desc(sessions.created_at))
    .limit(1);
  return s?.status ?? 'pending';
}

// Repo chrome for the Thread header: the most-recent session's repo metadata,
// or {null, null} if no Agent has ever connected.
export async function latestAttachedRepo(
  threadId: string,
): Promise<{ attached_repo_remote: string | null; attached_repo_path: string | null }> {
  const [s] = await db
    .select({
      attached_repo_remote: sessions.attached_repo_remote,
      attached_repo_path: sessions.attached_repo_path,
    })
    .from(sessions)
    .where(eq(sessions.thread_id, threadId))
    .orderBy(desc(sessions.created_at))
    .limit(1);
  return {
    attached_repo_remote: s?.attached_repo_remote ?? null,
    attached_repo_path: s?.attached_repo_path ?? null,
  };
}

export function nowIso() {
  return new Date().toISOString();
}

// SQLite stores `CURRENT_TIMESTAMP` as `YYYY-MM-DD HH:MM:SS` (UTC, no TZ marker);
// convert to ISO-8601 with `Z` for the wire shape.
export function toIso(s: string): string {
  if (s.endsWith('Z') || s.includes('T')) return s;
  return `${s.replace(' ', 'T')}Z`;
}
