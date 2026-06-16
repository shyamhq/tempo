import { randomBytes } from 'node:crypto';
import type { ThreadSummary } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import {
  attachments,
  comments,
  discussion_messages,
  events,
  plans,
  replies,
  sessions,
  spaces,
  threads,
  vm_runs,
} from '@tempo/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { appendEvent } from './event-log';
import { newPlanId, newThreadId } from './ids';
import { deletePrefix } from './r2';

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

export async function listThreads(workspaceId: string, spaceId?: string) {
  // Single LATERAL join — per-thread "latest session status" without an N+1.
  const filter = spaceId
    ? sql`t.workspace_id = ${workspaceId} AND t.space_id = ${spaceId}`
    : sql`t.workspace_id = ${workspaceId}`;
  const result = await db.execute<{
    id: string;
    title: string;
    description: string;
    status: 'unapproved' | 'approved';
    updated_at: Date | null;
    session_status: 'connected' | 'disconnected' | null;
  }>(sql`
    SELECT t.id, t.title, t.description, t.status, t.updated_at,
           s.status AS session_status
    FROM threads t
    LEFT JOIN LATERAL (
      SELECT status FROM sessions
      WHERE thread_id = t.id
      ORDER BY created_at DESC
      LIMIT 1
    ) s ON true
    WHERE ${filter}
    ORDER BY t.updated_at DESC
  `);
  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    session_status: r.session_status ?? 'pending',
    updated_at: r.updated_at?.toISOString() ?? null,
  }));
}

export async function getThread(threadId: string) {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  return row ?? null;
}

export async function approveThread(threadId: string) {
  await db
    .update(threads)
    .set({ status: 'approved', updated_at: new Date() })
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
    // FKs in the schema use the Postgres default (NO ACTION) — no ON DELETE
    // CASCADE — so we delete dependent rows explicitly. The R2 prefix-delete
    // below removes the underlying bytes.
    await tx.delete(attachments).where(eq(attachments.thread_id, threadId));
    await tx.delete(comments).where(eq(comments.thread_id, threadId));
    await tx.delete(discussion_messages).where(eq(discussion_messages.thread_id, threadId));
    await tx.delete(events).where(eq(events.thread_id, threadId));
    await tx.delete(sessions).where(eq(sessions.thread_id, threadId));
    await tx.delete(vm_runs).where(eq(vm_runs.thread_id, threadId));
    await tx.delete(plans).where(eq(plans.thread_id, threadId));
    await tx.delete(threads).where(eq(threads.id, threadId));
  });
  // R2 prefix-delete runs after the DB commit so a failed delete leaves an
  // orphan object that the 7-day lifecycle rule will sweep, not a dangling
  // DB row.
  try {
    await deletePrefix(threadId);
  } catch (e) {
    console.warn('attachment prefix-delete failed; lifecycle rule will sweep', {
      threadId,
      err: e,
    });
  }
}

// Single mutation for title and/or space_id so the route handler doesn't have
// to orchestrate two server calls. Both fields are optional but the caller
// (validated upstream by `UpdateThreadRequest`) must supply at least one.
// When `space_id` is present, we guard inside the transaction that the target
// Space belongs to the same workspace — a forged PATCH must not re-parent a
// Thread under a foreign workspace's Space.
export async function updateThread(
  threadId: string,
  patch: { title?: string; space_id?: string; sort_order?: number; description?: string },
): Promise<ThreadSummary> {
  const result = await db.transaction(async (tx) => {
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

    const set: Record<string, string | number | Date> = { updated_at: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.space_id !== undefined) set.space_id = patch.space_id;
    if (patch.sort_order !== undefined) set.sort_order = patch.sort_order;
    if (patch.description !== undefined) set.description = patch.description;
    await tx.update(threads).set(set).where(eq(threads.id, threadId));

    const titleChanged = patch.title !== undefined && patch.title !== t.title;
    return {
      thread: {
        id: t.id,
        title: patch.title ?? t.title,
        description: patch.description ?? t.description,
      },
      titleChanged,
    };
  });

  // Title changes drive live UI: the Thread header refreshes from the SSE
  // payload, and the sidebar invalidates its `['space-threads']` cache.
  // Emitted outside the tx so a failed event append doesn't roll back the
  // rename — matches the at-least-once posture of the other server modules.
  if (result.titleChanged) {
    await appendEvent(threadId, { kind: 'thread_renamed', title: result.thread.title });
  }

  return result.thread;
}

export async function reopenThread(threadId: string) {
  await db
    .update(threads)
    .set({ status: 'unapproved', updated_at: new Date() })
    .where(eq(threads.id, threadId));
}

// Source of truth is the event log — both CLI and hosted runtimes append
// `session_*` events on lifecycle transitions, but only the CLI/MCP path
// keeps the `sessions` row's `status` column updated. Reading from `events`
// keeps the UI in sync with the actual last known state regardless of mode.
const SESSION_KINDS = [
  'session_connected',
  'session_disconnected',
  'session_initiating',
  'session_failed',
] as const;
type SessionKind = (typeof SESSION_KINDS)[number];
const KIND_TO_STATUS: Record<SessionKind, 'connected' | 'disconnected' | 'initiating' | 'failed'> =
  {
    session_connected: 'connected',
    session_disconnected: 'disconnected',
    session_initiating: 'initiating',
    session_failed: 'failed',
  };

export async function latestSessionStatus(threadId: string) {
  const [last] = await db
    .select({ kind: events.kind })
    .from(events)
    .where(
      and(eq(events.thread_id, threadId), inArray(events.kind, SESSION_KINDS as unknown as string[])),
    )
    .orderBy(desc(events.id))
    .limit(1);
  if (!last) return 'pending';
  return KIND_TO_STATUS[last.kind as SessionKind] ?? 'pending';
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

// Phase 4b: thread-level auth checks. Agent ctx carries workspace_id only;
// routes load this to verify a thread URL param is in the agent's workspace.
export async function threadBelongsToWorkspace(
  threadId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ workspace_id: threads.workspace_id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  return row?.workspace_id === workspaceId;
}
