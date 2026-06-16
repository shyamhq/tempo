import { getEventsSinceLastTurn } from '@tempo/server';
import type { RequestHandler } from 'express';
import { touch } from '../../hosted/supervisor';

// Hosted runner's outer-loop "is there work?" probe. The Caller's threadId
// is JWT-bound (apps/worker/src/server/cli-auth.ts), so no body payload.
// Stateless query: returns wakeable events since the last agent_turn_ended.
// When the runner finishes a Turn it writes agent_turn_ended, which moves
// the floor — the next poll returns nothing until the Dev posts again.
//
// Non-empty drains touch the inactivity timer: Dev event arrived → runner
// is about to work → extend the lifetime. Empty drains are just polling,
// they intentionally don't reset the clock.
export const drainHostedHandler: RequestHandler = async (req, res) => {
  if (req.caller.kind !== 'hosted') {
    res.status(403).json({ error: 'hosted_only' });
    return;
  }
  const events = await getEventsSinceLastTurn(req.caller.threadId);
  if (events.length > 0) touch(req.caller.threadId);
  res.json({ events });
};
