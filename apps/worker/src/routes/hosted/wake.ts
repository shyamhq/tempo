import { db } from '@tempo/db/client';
import { threads } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { ForbiddenError } from '../../auth';
import { spawnHosted } from '../../hosted/supervisor';

// Hosted Agent spawn. Called from:
//   1. The Console's "Run Hosted Agent" button (browser caller, manual).
//   2. The Console event-log post-hook on wake-eligible Dev events
//      (internal caller, automatic).
// Rejects with 400 for Threads whose agent_type is not 'hosted'.
export const wakeHostedHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const caller = req.caller;
  if (caller.kind !== 'browser' && caller.kind !== 'internal') {
    throw new ForbiddenError('user_only');
  }
  const threadId = req.params.id;
  const [row] = await db
    .select({ workspaceId: threads.workspace_id, agentType: threads.agent_type })
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
  const result = await spawnHosted({ threadId, workspaceId: row.workspaceId });
  res.json(result);
};
