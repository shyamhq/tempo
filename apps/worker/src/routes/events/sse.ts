import {
  clearPresent,
  publishPresence,
  refreshPresent,
  setPresent,
  sseStream,
} from '@tempo/server';
import type { RequestHandler } from 'express';

// Keep the presence key comfortably inside its TTL (45s) so a live connection
// never lets it lapse.
const PRESENCE_REFRESH_MS = 15_000;

// GET /api/threads/:id/events — Redis-backed SSE stream of new events. Browsers,
// the local CLI, and the hosted runner all tail it. The agent's connection here
// IS its presence: while a cli/hosted connection is open we keep the Redis
// presence key fresh and push a `presence` frame so viewers flip instantly; the
// TTL is the abrupt-disconnect safety net. Browser viewers don't count.
export const sseHandler: RequestHandler<{ id: string }> = (req, res) => {
  const threadId = req.params.id;
  const isAgent = req.caller.kind === 'cli' || req.caller.kind === 'hosted';

  let presenceTimer: ReturnType<typeof setInterval> | null = null;
  if (isAgent) {
    void setPresent(threadId).catch(() => {});
    void publishPresence(threadId, true).catch(() => {});
    presenceTimer = setInterval(() => {
      void refreshPresent(threadId).catch(() => {});
    }, PRESENCE_REFRESH_MS);
  }

  // sseStream returns a Web API Response; pipe its body to the Express response.
  const webResponse = sseStream(threadId);
  const body = webResponse.body;
  if (!body) {
    if (presenceTimer) clearInterval(presenceTimer);
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

  req.on('close', () => {
    reader.cancel();
    if (isAgent) {
      if (presenceTimer) clearInterval(presenceTimer);
      void clearPresent(threadId).catch(() => {});
      void publishPresence(threadId, false).catch(() => {});
    }
  });
  pump();
};
