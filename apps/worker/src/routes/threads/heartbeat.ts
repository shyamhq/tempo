import { bumpAgentLastSeen } from '@tempo/server';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';

// POST /api/threads/:id/heartbeat
//
// The connected CLI pings this once per Redis XREAD cycle so Console presence
// (`now() - agent_last_seen_at < 60s`) stays fresh while the agent idles between
// turns. During a turn, MCP + gateway calls already bump `agent_last_seen_at`;
// this covers the idle gap left when the CLI stopped long-polling and now tails
// Redis directly. Fire-and-forget bump, 204 — nothing to return.
export const heartbeatHandler: RequestHandler<{ id: string }> = (req, res) => {
  // CLI-only primitive. rejectAgent already blocks agent/hosted/internal, so
  // the only other reachable caller is a browser — 403 it explicitly rather
  // than swallow a misrouted request as a silent 204.
  if (req.caller.kind !== 'cli') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  void bumpAgentLastSeen(req.params.id).catch((err) =>
    logger.error({ err, threadId: req.params.id }, 'heartbeat: bumpAgentLastSeen failed'),
  );
  res.status(204).end();
};
