import { emptyCursor, sseStream } from '@tempo/server';
import type { RequestHandler } from 'express';
import { logger } from '../../logger';

// GET /api/threads/:id/events — SSE stream for browser activity feed.
// Authorization handled by ensureThreadAccess middleware.
export const sseHandler: RequestHandler<{ id: string }> = async (req, res) => {
  const threadId = req.params.id;
  const cursorParam = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const cursor = cursorParam ?? (await emptyCursor(threadId));

  logger.debug({ threadId, cursor }, 'sse: starting stream');

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
        if (!res.writableEnded) {
          res.write(value);
        }
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
