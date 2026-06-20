import { db } from '@tempo/db/client';
import { threads } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { ForbiddenError } from '../../auth';
import { runConversationTurn } from '../../hosted/conversation';
import { spawnHosted } from '../../hosted/supervisor';
import { logger } from '../../logger';

const log = logger.child({ module: 'wake' });

// Hosted Agent wake. Called from:
//   1. The Console's "Run Hosted Agent" button (browser caller, manual).
//   2. The Console event-log post-hook on wake-eligible Dev events
//      (internal caller, automatic).
// Rejects with 400 for Threads whose agent_type is not 'hosted'.
//
// Branches on threads.repos (docs/plans/hosted-conversation-before-vm.md, the
// repos gate): repos present → provision a VM (spawnHosted); repos empty → run
// one in-process conversation turn (no Sandbox to clone into). The in-process
// path is fire-and-forget so the HTTP response doesn't block on a full LLM turn;
// runConversationTurn's Redis lock dedupes concurrent wakes on its own.
export const wakeHostedHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const caller = req.caller;
  if (caller.kind !== 'browser' && caller.kind !== 'internal') {
    throw new ForbiddenError('user_only');
  }
  const threadId = req.params.id;
  const [row] = await db
    .select({
      workspaceId: threads.workspace_id,
      agentType: threads.agent_type,
      repos: threads.repos,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: 'thread_not_found' });
    return;
  }
  if (row.agentType !== 'hosted') {
    res.status(400).json({ error: 'agent_type_mismatch' });
    return;
  }

  if (row.repos.length === 0) {
    // No repo to clone — run the planning turn in-process. Accept immediately;
    // the turn runs in the background (the lock dedupes concurrent wakes).
    void runConversationTurn(threadId).catch((err) =>
      log.error({ err, threadId, event: 'wake:conversation_failed' }, 'in-process turn failed'),
    );
    res.json({ status: 'conversation' });
    return;
  }

  const result = await spawnHosted({ threadId, workspaceId: row.workspaceId });
  res.json(result);
};
