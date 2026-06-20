import { randomUUID } from 'node:crypto';
import { shouldDeliverToAgent } from '@tempo/contracts';
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
  // Identifies THIS connection's ownership of the presence key, so a stale
  // connection's close can't clear a newer one's presence.
  const nonce = randomUUID();

  let presenceTimer: ReturnType<typeof setInterval> | null = null;
  if (isAgent) {
    void setPresent(threadId, nonce).catch(() => {});
    void publishPresence(threadId, true).catch(() => {});
    presenceTimer = setInterval(() => {
      void refreshPresent(threadId).catch(() => {});
    }, PRESENCE_REFRESH_MS);
  }

  // sseStream returns a Web API Response; pipe its body to the Express response.
  // Last-Event-ID (sent automatically by the client on reconnect) resumes the
  // Redis stream from where it dropped instead of the live tail.
  // Agents act only on wake + cancel — filter the rest server-side so a chatty
  // turn's echoes don't stream back. Browsers render the whole Thread.
  const webResponse = sseStream(
    threadId,
    req.header('Last-Event-ID'),
    isAgent ? shouldDeliverToAgent : undefined,
  );
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
      // Only push the offline frame if we still owned the key — a reconnect may
      // have already taken over presence on a fresher connection.
      void clearPresent(threadId, nonce)
        .then((wasOwner) => (wasOwner ? publishPresence(threadId, false) : undefined))
        .catch(() => {});
    }
  });
  pump();
};
