import { db } from '@tempo/db/client';
import { threads, workspaces } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { ForbiddenError } from '../../auth';
import { spawnHosted } from '../../hosted/supervisor';

// Explicit user-triggered Hosted Agent spawn. The wake button on the
// Console thread header POSTs here. Returns `{ status: 'spawned' | 'already_running' | 'hosted_off' }`.
export const wakeHostedHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const caller = req.caller;
  if (caller.kind !== 'browser') {
    throw new ForbiddenError('user_only');
  }
  const threadId = req.params.id;
  const [row] = await db
    .select({
      workspaceId: workspaces.id,
      hostedEnabled: workspaces.hosted_enabled,
    })
    .from(workspaces)
    .innerJoin(threads, eq(threads.workspace_id, workspaces.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: 'thread_not_found' });
    return;
  }
  if (!row.hostedEnabled) {
    res.json({ status: 'hosted_off' });
    return;
  }
  const result = await spawnHosted({ threadId, workspaceId: row.workspaceId });
  res.json(result);
};
