import type { Event } from '@tempo/contracts';
import { latestEventId, readEventsAfter } from './event-log';
import { getConnectedSessionLastSeenMs } from './sessions';

const POLL_INTERVAL_MS = 500;
const SSE_HEARTBEAT_MS = 25_000;
// CLI long-poll cadence is 25s. 45s threshold survives one slow poll without
// false-flipping, and stays well under a minute so a kill -9 dashboard catches
// it within the user's attention span.
const PRESENCE_THRESHOLD_MS = 45_000;
// How often the SSE loop re-evaluates presence. Cheap (one indexed SELECT).
const PRESENCE_CHECK_MS = 5_000;

export async function longPoll(
  threadId: string,
  cursor: string,
  waitSeconds: number,
): Promise<{ events: Event[]; cursor: string }> {
  const deadline = Date.now() + waitSeconds * 1000;
  let current = cursor;
  while (true) {
    const evs = await readEventsAfter(threadId, current);
    if (evs.length > 0) {
      current = evs[evs.length - 1]!.id;
      return { events: evs, cursor: current };
    }
    if (Date.now() >= deadline) {
      return { events: [], cursor: current };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function sseStream(threadId: string, cursor: string): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let current = cursor;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => enqueue(`: ping\n\n`), SSE_HEARTBEAT_MS);

      // Presence is derived live from the connected session's last_seen_at —
      // never persisted to the event log. Emit only on transition so quiet
      // CLIs don't flood the channel. `null` lets the first read fire.
      let lastFresh: boolean | null = null;
      let nextPresenceAt = 0;

      try {
        // Replay anything already past the cursor immediately, then poll.
        while (!closed) {
          if (Date.now() >= nextPresenceAt) {
            nextPresenceAt = Date.now() + PRESENCE_CHECK_MS;
            const seenMs = await getConnectedSessionLastSeenMs(threadId);
            const fresh = seenMs !== null && Date.now() - seenMs < PRESENCE_THRESHOLD_MS;
            if (fresh !== lastFresh) {
              enqueue(`event: presence\ndata: ${JSON.stringify({ fresh })}\n\n`);
              lastFresh = fresh;
            }
          }
          const evs = await readEventsAfter(threadId, current);
          for (const e of evs) {
            enqueue(`event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
            current = e.id;
          }
          if (closed) break;
          await sleep(POLL_INTERVAL_MS);
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

export async function emptyCursor(threadId: string): Promise<string> {
  return latestEventId(threadId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
