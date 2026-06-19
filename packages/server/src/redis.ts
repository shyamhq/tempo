// Redis is the real-time delivery channel; Postgres stays the source of truth.
// Every event is XADD'd to a per-thread stream that consumers tail with
// XREAD BLOCK. The same stream also carries ephemeral `presence` frames, and a
// per-thread presence key (with TTL) is the truth for "is the agent's SSE
// connection live." Old events live in Postgres and load on page open — the
// stream only needs enough recent entries to bridge a reconnect, so it's capped.

import type { Event, PresenceSignal } from '@tempo/contracts';
import Redis from 'ioredis';

const STREAM_PREFIX = 'tempo:t:';
const STREAM_MAXLEN = 1000;
const PRESENCE_PREFIX = 'tempo:presence:';
// TTL > the SSE refresh interval (15s) so a live connection never lets it lapse;
// an abrupt drop / Worker death expires it within this window.
const PRESENCE_TTL_SEC = 45;

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

// Fan a persisted event out to its thread's stream.
export async function appendToStream(threadId: string, event: Event): Promise<void> {
  await pushFrame(threadId, event);
}

// Ephemeral presence frame — same stream, never persisted to Postgres.
export async function publishPresence(threadId: string, online: boolean): Promise<void> {
  await pushFrame(threadId, { kind: 'presence', online });
}

// MAXLEN ~ caps the stream in the same round-trip (lazy, macro-node granularity).
// Auto-id (*) never rejects on concurrent writes; consumers order by the event's
// own evt_<seq> id, so stream order isn't authoritative.
async function pushFrame(threadId: string, frame: Event | PresenceSignal): Promise<void> {
  await redis().xadd(
    streamKey(threadId),
    'MAXLEN',
    '~',
    STREAM_MAXLEN,
    '*',
    'payload',
    JSON.stringify(frame),
  );
}

// Pull the JSON frame back out of a stream entry's flat [field, value, ...]
// array. Returns null on a missing or unparseable payload. Pure.
export function parseStreamEvent(fields: string[]): Event | PresenceSignal | null {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === 'payload') {
      try {
        return JSON.parse(fields[i + 1] as string) as Event | PresenceSignal;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// --- Presence: "is the agent's SSE connection live" -----------------------
// The Worker setPresent()s on an agent SSE connect, refreshPresent()s on the
// ping, and clearPresent()s on close. The TTL is the abrupt-disconnect safety
// net — no goodbye is ever trusted.
function presenceKey(threadId: string): string {
  return `${PRESENCE_PREFIX}${threadId}`;
}

export async function setPresent(threadId: string): Promise<void> {
  await redis().set(presenceKey(threadId), '1', 'EX', PRESENCE_TTL_SEC);
}

export async function refreshPresent(threadId: string): Promise<void> {
  // SET (not EXPIRE) so it self-heals if the key lapsed between connect and the
  // first refresh (e.g. a brief Worker restart) — EXPIRE no-ops on a missing key.
  await redis().set(presenceKey(threadId), '1', 'EX', PRESENCE_TTL_SEC);
}

export async function clearPresent(threadId: string): Promise<void> {
  await redis().del(presenceKey(threadId));
}

export async function isPresent(threadId: string): Promise<boolean> {
  return (await redis().exists(presenceKey(threadId))) === 1;
}

// Batch presence read for the threads list — one MGET, present iff non-null.
export async function arePresent(threadIds: string[]): Promise<Map<string, boolean>> {
  if (threadIds.length === 0) return new Map();
  const values = await redis().mget(threadIds.map(presenceKey));
  return new Map(threadIds.map((id, i) => [id, values[i] != null]));
}
