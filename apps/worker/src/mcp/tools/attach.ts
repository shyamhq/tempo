import type { AttachOutput } from '@tempo/contracts/mcp';
import { WORKFLOW } from '@tempo/contracts/workflow';
import { db } from '@tempo/db/client';
import { sessions, threads } from '@tempo/db/schema';
import {
  appendEvent,
  getPlanState,
  latestEventId,
  listCommentsForThread,
  listMessagesForThread,
  newSessionId,
} from '@tempo/server';
import { and, eq } from 'drizzle-orm';
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
  // The partial unique index `(thread_id) WHERE status='connected'` allows
  // at most one connected row per thread, so a prior Turn's row left at
  // status='connected' (transport.onclose doesn't fire on bare claude
  // process exit) must be displaced before the new row can be inserted.
  // Same pattern as createSessionFromToken in packages/server/src/sessions.ts.
  let displacedPrior = false;
  let insertedNew = false;
  if (mcpSessionId) {
    const existing = await getSessionByMcpId(mcpSessionId, thread.id);
    if (existing) {
      // Same MCP session re-calling attach. The agent already has full
      // state in its conversation memory from the original attach; returning
      // it again burns 5–10k tokens for nothing. Reject with a cheap hint
      // that tells the agent which tool to use instead. This is the
      // server-side enforcement of the WORKFLOW step 0 guideline.
      const cursor = await latestEventId(thread.id);
      return {
        error: `already_attached: this session already attached. Use tempo_poll with cursor "${cursor}" to fetch new events, or tempo_pull_plan to refresh the plan.`,
      };
    }
    await db.transaction(async (tx) => {
      const prior = await tx
        .update(sessions)
        .set({ status: 'disconnected', last_seen_at: new Date() })
        .where(and(eq(sessions.thread_id, thread.id), eq(sessions.status, 'connected')))
        .returning({ id: sessions.id });
      displacedPrior = prior.length > 0;
      const inserted = await tx
        .insert(sessions)
        .values({
          id: newSessionId(),
          thread_id: thread.id,
          mcp_session_id: mcpSessionId,
          status: 'connected',
          last_seen_at: new Date(),
        })
        // mcp_session_id has its own partial unique index; a concurrent
        // reconnect with the same UUID is still a clean no-op for the loser.
        .onConflictDoNothing()
        .returning({ id: sessions.id });
      insertedNew = inserted.length > 0;
    });
  }
  // Disconnect first, then connect — Console's reducer is last-write-wins;
  // a viewer that joins mid-displacement still ends at `connected`.
  if (displacedPrior) {
    await appendEvent(thread.id, { kind: 'session_disconnected' });
  }
  if (insertedNew) {
    await appendEvent(thread.id, { kind: 'session_connected' });
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
