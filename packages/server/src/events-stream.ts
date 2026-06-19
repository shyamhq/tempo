import { createReader, parseStreamEvent, streamKey } from './redis';

const BLOCK_MS = 25_000;

// Shape of an ioredis XREAD reply: one entry per requested stream key, each with
// its [id, [field, value, ...]] entries. null when the BLOCK times out.
type StreamReadReply = [key: string, entries: [id: string, fields: string[]][]][];

// SSE stream of new events for a Thread, tailing the Redis stream with
// XREAD BLOCK. Full Thread state loads separately (GET /api/threads/:id); this
// only delivers what arrives after subscribe. An idle stream issues zero DB
// queries — it blocks on Redis.
export function sseStream(threadId: string): Response {
  const encoder = new TextEncoder();
  const reader = createReader();
  const key = streamKey(threadId);
  let closed = false;
  let lastId = '$';

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
            if (event) enqueue(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
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

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
