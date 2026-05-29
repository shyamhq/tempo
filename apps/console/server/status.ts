import type { ActivityLabel, ActivityStatus } from '@tempo/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { events, sessions } from '../db/schema';
import { appendEvent } from './event-log';

export async function setActivityStatus(
  sessionId: string,
  label: ActivityLabel,
  detail?: string,
): Promise<void> {
  const [s] = await db
    .select({ thread_id: sessions.thread_id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!s) throw new Error('session_not_found');
  const status: ActivityStatus = detail !== undefined ? { label, detail } : { label };
  await appendEvent(s.thread_id, { kind: 'activity_pill', status });
}

export async function recordAgentToolUse(
  sessionId: string,
  tool: string,
  summary: string,
): Promise<void> {
  const [s] = await db
    .select({ thread_id: sessions.thread_id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!s) throw new Error('session_not_found');
  await appendEvent(s.thread_id, { kind: 'agent_tool_use', tool, summary });
}

export async function latestActivity(threadId: string): Promise<ActivityStatus | null> {
  const [row] = await db
    .select({ payload_json: events.payload_json })
    .from(events)
    .where(and(eq(events.thread_id, threadId), eq(events.kind, 'activity_pill')))
    .orderBy(desc(events.id))
    .limit(1);
  if (!row) return null;
  const payload = row.payload_json as { status?: ActivityStatus };
  return payload.status ?? null;
}
