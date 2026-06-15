import { db } from '@tempo/db/client';
import { threads, workspaces } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { authorizeThread, ForbiddenError } from '../../auth';
import { logger } from '../../logger';

// GET /api/threads/:id/access — CLI + browser preflight.
// Returns thread + workspace metadata so the CLI can display
// "Connecting to <workspace>'s Thread <title>" on connect.
//
// Doesn't use ensureThreadAccess middleware so it can return discriminated
// 404 (thread_not_found) responses; the standard middleware returns a
// uniform 403 forbidden body.
export const threadAccessHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const threadId = req.params.id;

  // Agent tokens are workspace-scoped and don't represent a User; this
  // preflight is meant for CLI + browser users only.
  if (req.caller.kind === 'agent') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    await authorizeThread(req.caller, threadId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (err.reason === 'thread_not_found') {
        res.status(404).json({ error: 'thread_not_found' });
        return;
      }
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    logger.error({ err }, 'threads/access: authorize crashed');
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  // authorizeThread already verified the thread exists and belongs to the
  // caller's workspace; this join just fetches the display fields.
  const [row] = await db
    .select({
      thread_id: threads.id,
      thread_title: threads.title,
      workspace_id: workspaces.id,
      workspace_name: workspaces.name,
    })
    .from(threads)
    .innerJoin(workspaces, eq(workspaces.id, threads.workspace_id))
    .where(eq(threads.id, threadId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: 'thread_not_found' });
    return;
  }

  res.json(row);
};
