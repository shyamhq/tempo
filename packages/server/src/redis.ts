// Redis is the real-time delivery channel; Postgres stays the source of truth.
// Every event is XADD'd to a per-thread stream that consumers tail with
// XREAD BLOCK. Old events live in Postgres and load on page open — the stream
// only needs enough recent entries to bridge a reconnect, so it's capped.

import type { Event } from '@tempo/contracts';
import Redis from 'ioredis';

const STREAM_PREFIX = 'tempo:t:';
const STREAM_MAXLEN = 1000;

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');
  return url;
}

export function streamKey(threadId: string): string {
  return `${STREAM_PREFIX}${threadId}`;
}

// Lazily-constructed shared connection for XADD + cache. Lazy so importing this
// module is side-effect-free — no socket and no REDIS_URL requirement until the
// first command — which keeps the Console build and Redis-free unit tests clean.
// Never used for blocking reads: a blocking command would monopolise it.
let shared: Redis | null = null;
export function redis(): Redis {
  if (!shared) {
    shared = new Redis(redisUrl(), { lazyConnect: true });
    shared.on('error', (err) => console.error('redis error', err));
  }
  return shared;
}

// Each XREAD BLOCK consumer (SSE stream) gets its own connection — a blocking
// command monopolises it. maxRetriesPerRequest:null stops ioredis flushing the
// blocking read after its default 20 retries; the block is meant to wait.
export function createReader(): Redis {
  const reader = new Redis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: true });
  reader.on('error', (err) => console.error('redis reader error', err));
  return reader;
}

// Fan an event out to its thread's stream. MAXLEN ~ trims to approximately
// STREAM_MAXLEN in the same round-trip (lazy, macro-node granularity — the
// stream may run slightly over, never under). Auto-id (*) never rejects on
// concurrent writes; consumers order by the event's own evt_<seq> id, so stream
// order isn't authoritative.
export async function appendToStream(threadId: string, event: Event): Promise<void> {
  await redis().xadd(
    streamKey(threadId),
    'MAXLEN',
    '~',
    STREAM_MAXLEN,
    '*',
    'payload',
    JSON.stringify(event),
  );
}

// Pull the JSON event back out of a stream entry's flat [field, value, ...]
// fields array. Returns null on a missing or unparseable payload. Pure —
// unit-tested without Redis.
export function parseStreamEvent(fields: string[]): Event | null {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === 'payload') {
      try {
        return JSON.parse(fields[i + 1] as string) as Event;
      } catch {
        return null;
      }
    }
  }
  return null;
}
