import { randomBytes } from 'node:crypto';
import { emptyCursor, longPoll, sseStream } from '@tempo/server';
import { EventsQuery } from '@tempo/contracts/http';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { addConnection, isFresh, removeConnection } from '../../server/presence';

// GET /api/threads/:id/events
//
// Two modes, same route + auth chain:
// - SSE stream (no `wait` param): Console activity feed + legacy CLI wake loop.
// - Long-poll (?cursor=X&wait=N): CLI event delivery. Returns EventsLongPollResponse
//   JSON immediately with current events, or waits up to N seconds for new ones.
//   CLI callers register presence via X-Tempo-Conn-Id header so the Console
//   presence chip reflects the active session.
export const sseHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const threadId = req.params.id;

  if (typeof req.query.wait === 'string') {
    const query = EventsQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'bad_request', message: 'cursor required for long-poll' });
      return;
    }
    const rawConnId = req.headers['x-tempo-conn-id'];
    const cliConnId = req.caller.kind === 'cli' && typeof rawConnId === 'string' ? rawConnId : null;
    if (cliConnId) addConnection(threadId, cliConnId);
    try {
      const result = await longPoll(threadId, query.data.cursor, query.data.wait ?? 25);
      res.json(result);
    } finally {
      if (cliConnId) removeConnection(threadId, cliConnId);
    }
    return;
  }

  const cursorParam = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const cursor = cursorParam ?? (await emptyCursor(threadId));

  logger.debug({ threadId, cursor, caller: req.caller.kind }, 'sse: starting stream');

  // Only CLI connections register as presence; browser connections are
  // consumers of the presence frames sseStream emits.
  const cliConnId = req.caller.kind === 'cli' ? randomBytes(8).toString('hex') : null;
  if (cliConnId) addConnection(threadId, cliConnId);

  // sseStream returns a Web API Response; pipe its body to the Express response.
  const webResponse = sseStream(threadId, cursor, { isFresh });
  const body = webResponse.body;
  if (!body) {
    if (cliConnId) removeConnection(threadId, cliConnId);
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
        if (!res.writableEnded) {
          res.write(value);
        }
      }
    } catch {
      // client disconnected
    } finally {
      if (cliConnId) removeConnection(threadId, cliConnId);
      if (!res.writableEnded) res.end();
    }
  };

  req.on('close', () => reader.cancel());
  pump();
};
