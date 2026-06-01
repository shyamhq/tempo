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
