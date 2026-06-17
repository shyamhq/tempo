import { AgentEventRequest } from '@tempo/contracts/http';
import { type AppendPayload, appendEvent, markAgentDisconnected } from '@tempo/server';
import type { RequestHandler } from 'express';
import { authorizeThread, ForbiddenError } from '../../auth';
import { touch } from '../../hosted/supervisor';
import { logger } from '../../logger';

// POST /api/agent-events — sk_user_* (Local CLI) or sk_hosted_* (Hosted VM).
// The threadId arrives in the body so we can't use ensureThreadAccess (which
// reads :id from the URL). We authorize inline after parsing.
//
// Agent workspace keys are blocked: they have no per-Thread identity.
export const agentEventsHandler: RequestHandler = async (req, res) => {
  if (req.caller.kind !== 'cli' && req.caller.kind !== 'hosted') {
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
    // CLI explicit goodbye: null the presence column before emitting the event,
    // so a Console refetch that races the SSE delivery still sees idle.
    if (event.kind === 'agent_disconnected') await markAgentDisconnected(thread_id);
    await appendEvent(thread_id, event as AppendPayload);
    if (req.caller.kind === 'hosted') touch(thread_id);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, 'agent-events: append failed');
    res.status(500).json({ error: 'internal_error' });
  }
};
