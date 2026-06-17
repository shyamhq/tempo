import { EventsQuery } from '@tempo/contracts/http';
import { bumpAgentLastSeen, emptyCursor, longPoll, sseStream } from '@tempo/server';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';

// GET /api/threads/:id/events
//
// Two modes, same route + auth chain:
// - SSE stream (no `wait` param): Console activity feed.
// - Long-poll (?cursor=X&wait=N): CLI event delivery. Returns EventsLongPollResponse
//   JSON immediately with current events, or waits up to N seconds for new ones.
// Each CLI hit bumps `threads.agent_last_seen_at`; Console derives presence as
// `now() - agent_last_seen_at < 60s`. No registry, no Map.
export const sseHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const threadId = req.params.id;

  if (typeof req.query.wait === 'string') {
    const query = EventsQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'bad_request', message: 'cursor required for long-poll' });
      return;
    }
    if (req.caller.kind === 'cli') {
      void bumpAgentLastSeen(threadId).catch((err) =>
        logger.error({ err, threadId }, 'sse: bumpAgentLastSeen failed'),
      );
    }
    const result = await longPoll(threadId, query.data.cursor, query.data.wait ?? 25);
    res.json(result);
    return;
  }

  const cursorParam = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const cursor = cursorParam ?? (await emptyCursor(threadId));

  logger.debug({ threadId, cursor, caller: req.caller.kind }, 'sse: starting stream');

  // sseStream returns a Web API Response; pipe its body to the Express response.
  const webResponse = sseStream(threadId, cursor);
  const body = webResponse.body;
  if (!body) {
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const reader = body.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) res.write(value);
      }
    } catch {
      // client disconnected
    } finally {
      if (!res.writableEnded) res.end();
    }
  };

  req.on('close', () => reader.cancel());
  pump();
};
