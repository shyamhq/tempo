import { db } from '@tempo/db/client';
import { threads, workspaces } from '@tempo/db/schema';
import { getEventsSinceLastTurn, getTurnHydration } from '@tempo/server';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { authorizeThread, ForbiddenError } from '../../auth';
import { touch } from '../../hosted/supervisor';
import { logger } from '../../logger';

// GET /api/threads/:id/access — unified turn-1 bootstrap for BOTH agent styles
// (local CLI + hosted runner) and the browser. Returns thread/workspace display
// fields plus `context` (the full turn-1 snapshot) and `events` (wake events
// since the last turn, so a freshly-(re)started agent catches up on what it
// missed). The hosted runner replaced its old POST /hosted/drain with this.
//
// Doesn't use ensureThreadAccess middleware so it can return a discriminated
// 404 (thread_not_found); the standard middleware returns a uniform 403.
export const threadAccessHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const threadId = req.params.id;

  // Workspace-scoped agent keys (no single thread) and the internal token have
  // no business here. cli, browser, and the thread-bound hosted runner do.
  if (req.caller.kind === 'agent' || req.caller.kind === 'internal') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    await authorizeThread(req.caller, threadId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (err.message === 'thread_not_found') {
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

  const [events, context] = await Promise.all([
    getEventsSinceLastTurn(threadId),
    getTurnHydration(threadId),
  ]);
  if (!context) {
    res.status(404).json({ error: 'thread_not_found' });
    return;
  }
  // A freshly-spawned hosted runner hydrates here before its first MCP call —
  // reset the supervisor's inactivity timer so it isn't reaped mid-turn-1.
  if (req.caller.kind === 'hosted') touch(threadId);
  res.json({ ...row, context, events });
};
