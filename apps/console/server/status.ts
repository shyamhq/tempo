import type { AgentTodo } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions } from '../db/schema';
import { appendEvent } from './event-log';

export async function recordAgentToolUse(
  sessionId: string,
  tool: string,
  summary: string,
): Promise<void> {
  const threadId = await threadIdForSession(sessionId);
  await appendEvent(threadId, { kind: 'agent_tool_use', tool, summary });
}

export async function recordAgentTodosUpdated(
  sessionId: string,
  todos: AgentTodo[],
): Promise<void> {
  const threadId = await threadIdForSession(sessionId);
  await appendEvent(threadId, { kind: 'agent_todos_updated', todos });
}

export async function recordAgentTurnEnded(sessionId: string): Promise<void> {
  const threadId = await threadIdForSession(sessionId);
  await appendEvent(threadId, { kind: 'agent_turn_ended' });
}

async function threadIdForSession(sessionId: string): Promise<string> {
  const [s] = await db
    .select({ thread_id: sessions.thread_id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!s) throw new Error('session_not_found');
  return s.thread_id;
}
