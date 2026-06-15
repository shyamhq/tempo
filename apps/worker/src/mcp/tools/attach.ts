import type { AttachOutput } from '@tempo/contracts/mcp';
import { WORKFLOW } from '@tempo/contracts/workflow';
import { db } from '@tempo/db/client';
import { sessions, threads } from '@tempo/db/schema';
import {
  getPlanState,
  latestEventId,
  listCommentsForThread,
  listMessagesForThread,
  newSessionId,
} from '@tempo/server';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { authorizeThread, type Caller, ForbiddenError } from '../../auth';
import { getSessionByMcpId } from '../../server/auth-lookup';

type AttachResult = z.infer<typeof AttachOutput>;

// mcpSessionId is the UUID assigned by the MCP transport layer — used to
// establish a sticky session row so reconnects resume the same session.
export async function runAttach(
  threadId: string,
  caller: Caller,
  mcpSessionId: string | undefined,
): Promise<AttachResult | { error: string }> {
  // Authorize: agent → cross-workspace check; cli/browser → membership.
  // ForbiddenError reasons map to the AttachOutput error string the SDK expects.
  try {
    await authorizeThread(caller, threadId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (err.reason === 'thread_not_found') return { error: 'thread_not_found' };
      if (err.reason === 'not_member') return { error: 'not_a_member' };
      return { error: 'unauthorized' };
    }
    throw err;
  }

  const [thread] = await db
    .select({
      id: threads.id,
      title: threads.title,
      description: threads.description,
      status: threads.status,
      workspace_id: threads.workspace_id,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) return { error: 'thread_not_found' };

  // Sticky session: find or create a sessions row keyed by MCP session UUID.
  // This allows the Agent to reconnect (e.g. after a network blip) and resume
  // the same logical session without re-creating a row each time.
  if (mcpSessionId) {
    const existing = await getSessionByMcpId(mcpSessionId, thread.id);
    if (!existing) {
      // The partial unique index on (mcp_session_id) WHERE NOT NULL turns the
      // concurrent-reconnect race into a clean no-op for the loser.
      await db
        .insert(sessions)
        .values({
          id: newSessionId(),
          thread_id: thread.id,
          mcp_session_id: mcpSessionId,
          status: 'connected',
          last_seen_at: new Date(),
        })
        .onConflictDoNothing();
    }
  }

  const [plan, threadComments, messages, last_event_id] = await Promise.all([
    getPlanState(thread.id),
    listCommentsForThread(thread.id),
    listMessagesForThread(thread.id),
    latestEventId(thread.id),
  ]);

  return {
    thread: { id: thread.id, title: thread.title, description: thread.description },
    plan,
    comments: threadComments,
    discussion: { messages },
    last_event_id,
    workflow: WORKFLOW,
  };
}
