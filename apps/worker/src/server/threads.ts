import type { ThreadSummary } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import { sessions, spaces, threads } from '@tempo/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { appendEvent } from './event-log';

// Agent-facing thread accessors. Only the subset needed by the Worker's MCP
// tools and browser routes. Console keeps createThread, deleteThread,
// listThreads, getConnectToken, approveThread, reopenThread.

export async function getThread(threadId: string) {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  return row ?? null;
}

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

  if (result.titleChanged) {
    await appendEvent(threadId, { kind: 'thread_renamed', title: result.thread.title });
  }

  return result.thread;
}

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

export async function latestSessionStatus(threadId: string) {
  const [s] = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.thread_id, threadId))
    .orderBy(desc(sessions.created_at))
    .limit(1);
  return s?.status ?? 'pending';
}

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
