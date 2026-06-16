import { getEventsSinceLastTurn, getTurnHydration } from '@tempo/server';
import type { RequestHandler } from 'express';
import { touch } from '../../hosted/supervisor';

// Hosted runner's outer-loop "is there work?" probe. The Caller's threadId
// is JWT-bound (apps/worker/src/server/cli-auth.ts), so no body payload.
//
// When the wake batch is non-empty we hydrate everything the agent needs
// for the Turn — Plan blocks, Comments, Discussion, thread meta, cursor —
// so the agent doesn't have to spend three MCP roundtrips (attach + poll +
// pull_plan) re-fetching state the worker already has. Empty drains stay
// minimal (no DB hit beyond the events query).
//
// Non-empty drains also touch the inactivity timer.
export const drainHostedHandler: RequestHandler = async (req, res) => {
  if (req.caller.kind !== 'hosted') {
    res.status(403).json({ error: 'hosted_only' });
    return;
  }
  const events = await getEventsSinceLastTurn(req.caller.threadId);
  if (events.length === 0) {
    res.json({ events });
    return;
  }
  const context = await getTurnHydration(req.caller.threadId);
  // Thread was deleted between the events query and the hydration query.
  // Surface as "no work" so the runner sleeps and the supervisor reaps —
  // a Turn against a deleted thread would produce undefined behavior.
  if (!context) {
    res.json({ events: [] });
    return;
  }
  touch(req.caller.threadId);
  res.json({ events, context });
};
