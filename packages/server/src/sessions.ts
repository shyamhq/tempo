import { db } from '@tempo/db/client';
import { sessions, threads, workspaces } from '@tempo/db/schema';
import { and, eq } from 'drizzle-orm';
import { appendEvent } from './event-log';
import { newSessionId } from './ids';

export type CreateSessionResult =
  | { ok: true; session_id: string; thread_id: string; agent_api_key: string }
  | { ok: false; error: 'invalid_token' };

export async function createSessionFromToken(
  token: string,
  attached: { repo_remote?: string | null; repo_path?: string | null },
): Promise<CreateSessionResult> {
  const [thread] = await db
    .select({ id: threads.id, workspace_id: threads.workspace_id })
    .from(threads)
    .where(eq(threads.connect_token, token))
    .limit(1);
  if (!thread) return { ok: false, error: 'invalid_token' };

  const [ws] = await db
    .select({ agent_api_key: workspaces.agent_api_key })
    .from(workspaces)
    .where(eq(workspaces.id, thread.workspace_id))
    .limit(1);
  if (!ws) return { ok: false, error: 'invalid_token' };

  const sessionId = newSessionId();
  let displaced = 0;
  await db.transaction(async (tx) => {
    const prior = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.thread_id, thread.id), eq(sessions.status, 'connected')));
    displaced = prior.length;
    for (const p of prior) {
      await tx
        .update(sessions)
        .set({ status: 'disconnected', last_seen_at: new Date() })
        .where(eq(sessions.id, p.id));
    }
    await tx.insert(sessions).values({
      id: sessionId,
      thread_id: thread.id,
      status: 'connected',
      attached_repo_remote: attached.repo_remote ?? null,
      attached_repo_path: attached.repo_path ?? null,
    });
  });

  if (displaced > 0) {
    await appendEvent(thread.id, { kind: 'session_disconnected' });
  }
  await appendEvent(thread.id, { kind: 'session_connected' });

  return {
    ok: true,
    session_id: sessionId,
    thread_id: thread.id,
    agent_api_key: ws.agent_api_key,
  };
}

export async function getSession(sessionId: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return s ?? null;
}

export async function cancelCurrentSessionForThread(
  threadId: string,
): Promise<
  | { ok: true; session_id: string }
  | { ok: false; error: 'thread_not_found' | 'no_connected_session' }
> {
  const [t] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!t) return { ok: false, error: 'thread_not_found' };
  const [s] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.thread_id, threadId), eq(sessions.status, 'connected')))
    .limit(1);
  if (!s) return { ok: false, error: 'no_connected_session' };
  await appendEvent(threadId, { kind: 'agent_cancel_requested', session_id: s.id });
  return { ok: true, session_id: s.id };
}

// Creates a sticky MCP session row for a CLI/browser caller. Displaces any
// prior connected row for the thread and fires session lifecycle events.
// Called by the transport on new connection — not by the agent via tempo_attach.
export async function createMcpSession(threadId: string, mcpSessionId: string): Promise<void> {
  let displacedPrior = false;
  let insertedNew = false;
  await db.transaction(async (tx) => {
    const prior = await tx
      .update(sessions)
      .set({ status: 'disconnected', last_seen_at: new Date() })
      .where(and(eq(sessions.thread_id, threadId), eq(sessions.status, 'connected')))
      .returning({ id: sessions.id });
    displacedPrior = prior.length > 0;
    const inserted = await tx
      .insert(sessions)
      .values({
        id: newSessionId(),
        thread_id: threadId,
        mcp_session_id: mcpSessionId,
        status: 'connected',
        last_seen_at: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: sessions.id });
    insertedNew = inserted.length > 0;
  });
  if (displacedPrior) await appendEvent(threadId, { kind: 'session_disconnected' });
  if (insertedNew) await appendEvent(threadId, { kind: 'session_connected' });
}

export async function markSessionDisconnected(mcpSessionId: string): Promise<boolean> {
  const flipped = await db
    .update(sessions)
    .set({ status: 'disconnected', last_seen_at: new Date() })
    .where(and(eq(sessions.mcp_session_id, mcpSessionId), eq(sessions.status, 'connected')))
    .returning({ thread_id: sessions.thread_id });
  const row = flipped[0];
  if (!row) return false;
  await appendEvent(row.thread_id, { kind: 'session_disconnected' });
  return true;
}

export async function touchSessionLastSeen(mcpSessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ last_seen_at: new Date() })
    .where(and(eq(sessions.mcp_session_id, mcpSessionId), eq(sessions.status, 'connected')));
}

export async function sessionBelongsToWorkspace(
  sessionId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ workspace_id: threads.workspace_id })
    .from(sessions)
    .innerJoin(threads, eq(sessions.thread_id, threads.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row?.workspace_id === workspaceId;
}
