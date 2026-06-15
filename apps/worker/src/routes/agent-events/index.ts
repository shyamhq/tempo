import { AgentEventRequest } from '@tempo/contracts/http';
import type { RequestHandler } from 'express';
import { authorizeThread, ForbiddenError } from '../../auth';
import { logger } from '../../logger';
import { type AppendPayload, appendEvent } from '../../server/event-log';

// POST /api/agent-events — sk_user_* only.
// The threadId arrives in the body so we can't use ensureThreadAccess (which
// reads :id from the URL). We authorize inline after parsing.
//
// CLI-only because this is a User attribution surface; agent keys are
// workspace-scoped and have no userId to attribute the event to.
export const agentEventsHandler: RequestHandler = async (req, res) => {
  if (req.caller.kind !== 'cli') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const parsed = AgentEventRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  const { thread_id, event } = parsed.data;

  try {
    await authorizeThread(req.caller, thread_id);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    logger.error({ err }, 'agent-events: authorize crashed');
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  try {
    await appendEvent(thread_id, event as AppendPayload);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, 'agent-events: append failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
