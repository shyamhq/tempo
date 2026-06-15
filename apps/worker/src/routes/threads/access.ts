import { db } from '@tempo/db/client';
import { threads, workspaces } from '@tempo/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { assertMembership, NotAMemberError } from '../../server/auth-lookup';

// GET /api/threads/:id/access — requires sk_user_* or Clerk JWT.
// Returns thread + workspace metadata for CLI callers to display on connect.
export const threadAccessHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const threadId = req.params.id;
  if (!threadId) {
    res.status(400).json({ error: 'missing_thread_id' });
    return;
  }

  const { userId, authSource, workspaceId } = res.locals;

  // Agent tokens (sk_agent_*) are workspace-scoped and do not carry a userId.
  // This route is CLI + browser only.
  if (authSource === 'agent') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    let resolvedWorkspaceId: string;

    if (authSource === 'cli') {
      // CLI path: verify membership and resolve workspaceId.
      // userId is always set on the cli branch (middleware contract); the guard
      // is a defensive 401 in case of a middleware bug.
      if (!userId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const { workspaceId: wsId } = await assertMembership(userId, threadId);
      resolvedWorkspaceId = wsId;
    } else {
      // Browser path: workspaceId comes from the Clerk JWT org_id claim.
      // If the JWT had no org_id (no active org), reject.
      if (!workspaceId) {
        res.status(403).json({ error: 'no_active_org' });
        return;
      }
      resolvedWorkspaceId = workspaceId;
    }

    // Fetch thread + workspace name in one join.
    const [row] = await db
      .select({
        thread_id: threads.id,
        thread_title: threads.title,
        workspace_id: workspaces.id,
        workspace_name: workspaces.name,
      })
      .from(threads)
      .innerJoin(workspaces, eq(workspaces.id, threads.workspace_id))
      .where(and(eq(threads.id, threadId), eq(threads.workspace_id, resolvedWorkspaceId)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'thread_not_found' });
      return;
    }

    res.json(row);
  } catch (err) {
    if (err instanceof NotAMemberError) {
      logger.debug({ err: err.message }, 'threads/access: not a member');
      res.status(403).json({ error: 'not_a_member' });
      return;
    }
    logger.error({ err }, 'threads/access: unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
};
