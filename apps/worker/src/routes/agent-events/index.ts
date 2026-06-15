import { AgentEventRequest } from '@tempo/contracts/http';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { assertMembership, NotAMemberError } from '../../server/auth-lookup';
import { appendEvent } from '../../server/event-log';

// POST /api/agent-events — sk_user_* only.
// Accepts structured agent lifecycle events from the new CLI and appends them
// to the shared event log via the appendEvent helper in server/event-log.ts.
// Thread access is verified via membership check.
export const agentEventsHandler: RequestHandler = async (req, res) => {
  // Only CLI callers (sk_user_*) may emit agent events — this is a User
  // attribution surface. Agent keys (sk_agent_*) are workspace-scoped and
  // have no userId to attribute the event to.
  if (res.locals.authSource !== 'cli') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const userId = res.locals.userId;
  if (!userId) {
    // Defensive: middleware should always set userId when authSource is 'cli'.
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const parsed = AgentEventRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  const { thread_id, event } = parsed.data;

  try {
    await assertMembership(userId, thread_id);
  } catch (err) {
    if (err instanceof NotAMemberError) {
      logger.debug({ err: err.message }, 'agent-events: not a member');
      res.status(403).json({ error: 'not_a_member' });
      return;
    }
    logger.error({ err }, 'agent-events: membership check failed');
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  try {
    await appendEvent(thread_id, event as { kind: string } & Record<string, unknown>);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, 'agent-events: append failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
