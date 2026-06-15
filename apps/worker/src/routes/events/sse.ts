import { randomBytes } from 'node:crypto';
import { emptyCursor, sseStream } from '@tempo/server';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';
import { addConnection, isFresh, removeConnection } from '../../server/presence';

// GET /api/threads/:id/events — SSE stream for Console activity feed +
// CLI event wake-up loop. Authorization handled by ensureThreadAccess.
//
// Presence: when a `cli` caller opens this stream the connection counts
// as one live CLI Session for the Thread; Console-side subscribers learn
// of the transition via the `presence` SSE frames emitted by sseStream.
// Browser connections are *consumers* of presence, never sources of it.
export const sseHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const threadId = req.params.id;
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
