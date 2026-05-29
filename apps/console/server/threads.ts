import type { ThreadSummary } from '@tempo/contracts';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { defaultWorkspaceId } from '../db/ids';
import {
  clarification_rounds,
  comments,
  discussion_messages,
  events,
  plans,
  replies,
  sessions,
  threads,
} from '../db/schema';
import { newPlanId, newThreadId } from './ids';
import { mintConnectToken } from './tokens';

export async function createThread(
  workspaceId: string,
  title: string,
  description: string,
): Promise<{ thread: ThreadSummary; connect_token: string }> {
  const { token, hash } = mintConnectToken();
  const id = newThreadId();
  await db.transaction(async (tx) => {
    await tx.insert(threads).values({
      id,
      workspace_id: workspaceId,
      title,
      description,
      connect_token_hash: hash,
    });
    await tx.insert(plans).values({ id: newPlanId(), thread_id: id });
  });
  return { thread: { id, title, description }, connect_token: token };
}

export async function listThreads(workspaceId: string = defaultWorkspaceId) {
  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      description: threads.description,
      status: threads.status,
      updated_at: threads.updated_at,
    })
    .from(threads)
    .where(eq(threads.workspace_id, workspaceId))
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
    await tx.delete(clarification_rounds).where(eq(clarification_rounds.thread_id, threadId));
    await tx.delete(events).where(eq(events.thread_id, threadId));
    await tx.delete(sessions).where(eq(sessions.thread_id, threadId));
    await tx.delete(plans).where(eq(plans.thread_id, threadId));
    await tx.delete(threads).where(eq(threads.id, threadId));
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
