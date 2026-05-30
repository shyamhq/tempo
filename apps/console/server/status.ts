import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions } from '../db/schema';
import { appendEvent } from './event-log';

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
