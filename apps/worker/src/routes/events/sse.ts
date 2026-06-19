import { sseStream } from '@tempo/server';
import type { RequestHandler } from 'express';

// GET /api/threads/:id/events — Redis-backed SSE stream of new events for the
// Console activity feed. Full Thread state loads via GET /api/threads/:id; this
// only delivers what arrives after subscribe. Idle connections issue zero DB
// queries (they block on Redis). The CLI no longer uses this route — it tails
// the Redis stream directly.
export const sseHandler: RequestHandler<{ id: string }> = (req, res) => {
  const threadId = req.params.id;

  // sseStream returns a Web API Response; pipe its body to the Express response.
  const webResponse = sseStream(threadId);
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
