import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions, threads } from '../db/schema';
import { appendEvent } from './event-log';
import { newSessionId } from './ids';
import { nowIso } from './threads';

export type CreateSessionResult =
  | { ok: true; session_id: string; thread_id: string }
  | { ok: false; error: 'invalid_token' };

export async function createSessionFromToken(
  token: string,
  attached: { repo_remote?: string | null; repo_path?: string | null },
): Promise<CreateSessionResult> {
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.connect_token, token))
    .limit(1);
  if (!thread) return { ok: false, error: 'invalid_token' };

  const sessionId = newSessionId();
  let displaced = 0;
  await db.transaction(async (tx) => {
    // Mark any prior connected session disconnected so the D8 partial unique
    // index ('one connected per thread') accepts our new row.
    const prior = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.thread_id, thread.id), eq(sessions.status, 'connected')));
    displaced = prior.length;
    for (const p of prior) {
      await tx
        .update(sessions)
        .set({ status: 'disconnected', last_seen_at: nowIso() })
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

  return { ok: true, session_id: sessionId, thread_id: thread.id };
}

export async function getSession(sessionId: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return s ?? null;
}

export type CancelCurrentSessionResult =
  | { ok: true; session_id: string }
  | { ok: false; error: 'thread_not_found' | 'no_connected_session' };

export async function cancelCurrentSessionForThread(
  threadId: string,
): Promise<CancelCurrentSessionResult> {
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

// Idempotent and race-free. The UPDATE is filtered on status='connected' and
// uses RETURNING so concurrent callers (reaper + explicit /disconnect) can't
// both flip the same row and emit duplicate session_disconnected events.
export async function markSessionDisconnected(sessionId: string): Promise<boolean> {
  const flipped = await db
    .update(sessions)
    .set({ status: 'disconnected', last_seen_at: nowIso() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, 'connected')))
    .returning({ thread_id: sessions.thread_id });
  const row = flipped[0];
  if (!row) return false;
  await appendEvent(row.thread_id, { kind: 'session_disconnected' });
  return true;
}

// Heartbeat update. Filtered on status='connected' so a freshly-disconnected
// row cannot be resurrected by an in-flight poll's heartbeat write.
export async function touchSessionLastSeen(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ last_seen_at: nowIso() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, 'connected')));
}

// Returns the connected session's last_seen_at (ms epoch) for a thread, or
// null if no row is connected. Used by the SSE stream to derive ephemeral
// "agent present" UX state from heartbeat freshness — disconnected is never
// written to the DB on the strength of staleness alone.
export async function getConnectedSessionLastSeenMs(threadId: string): Promise<number | null> {
  const [s] = await db
    .select({ last_seen_at: sessions.last_seen_at })
    .from(sessions)
    .where(and(eq(sessions.thread_id, threadId), eq(sessions.status, 'connected')))
    .limit(1);
  if (!s) return null;
  return Date.parse(s.last_seen_at);
}
