import type { Event, PresenceSignal, VmSignal } from '@tempo/contracts';
import { createReader, parseStreamEvent, streamKey } from './redis';

const BLOCK_MS = 25_000;

// Shape of an ioredis XREAD reply: one entry per requested stream key, each with
// its [id, [field, value, ...]] entries. null when the BLOCK times out.
type StreamReadReply = [key: string, entries: [id: string, fields: string[]][]][];

// SSE stream of new events for a Thread, tailing the Redis stream with
// XREAD BLOCK. Full Thread state loads separately (GET /api/threads/:id); this
// only delivers what arrives after subscribe. An idle stream issues zero DB
// queries — it blocks on Redis.
//
// `lastEventId` (the client's Last-Event-ID header on reconnect) resumes from
// that Redis entry; absent, the stream starts from the live tail ($).
export function sseStream(
  threadId: string,
  lastEventId?: string,
  // Optional per-connection filter; Agent connections pass `shouldDeliverToAgent`.
  filter?: (event: Event | PresenceSignal | VmSignal) => boolean,
): Response {
  const encoder = new TextEncoder();
  const reader = createReader();
  const key = streamKey(threadId);
  let closed = false;
  let lastId = lastEventId ?? '$';

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

      try {
        while (!closed) {
          const reply = (await reader.xread(
            'BLOCK',
            BLOCK_MS,
            'STREAMS',
            key,
            lastId,
          )) as StreamReadReply | null;
          if (closed) break;
          if (reply === null) {
            enqueue(`: ping\n\n`);
            continue;
          }
          const entries = reply[0]?.[1] ?? [];
          for (const [id, fields] of entries) {
            lastId = id;
            const event = parseStreamEvent(fields);
            // `id:` lets the client resume via Last-Event-ID; consumers route on
            // `data.kind`, so every frame is a default `message` event. A filtered
            // frame still advanced `lastId`, so reconnect won't re-read it.
            if (event && (!filter || filter(event))) {
              enqueue(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
            }
          }
        }
      } catch {
        // reader.disconnect() rejects the pending xread — expected on cancel.
      } finally {
        reader.disconnect();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      closed = true;
      reader.disconnect();
    },
  });

  // Just a body carrier — the only caller (Worker sse.ts) reads `.body` and sets
  // the SSE headers on its own Express response, so headers here would be dead.
  return new Response(stream);
}
