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
// The Worker setPresent()s on an agent SSE connect (with a per-connection
// nonce), refreshPresent()s on a timer, and clearPresent()s on close. The TTL
// is the abrupt-disconnect safety net — no goodbye is ever trusted. The nonce
// keeps overlapping connections honest: a stale connection's late close can't
// evict a newer connection's presence.
function presenceKey(threadId: string): string {
  return `${PRESENCE_PREFIX}${threadId}`;
}

export async function setPresent(threadId: string, nonce: string): Promise<void> {
  await redis().set(presenceKey(threadId), nonce, 'EX', PRESENCE_TTL_SEC);
}

// EXPIRE (not SET) so a refresh only bumps the TTL and never overwrites the
// owning nonce — a stale connection's refresh keeps the live one's key alive
// rather than stealing it. (SET here would re-introduce the clobber this nonce
// scheme fixes. The 15s refresh vs 45s TTL margin means a live connection never
// lets the key lapse, so EXPIRE never no-ops in practice.)
export async function refreshPresent(threadId: string): Promise<void> {
  await redis().expire(presenceKey(threadId), PRESENCE_TTL_SEC);
}

// Compare-and-delete: clears the key only if it still holds our nonce, so an
// old connection's close can't evict a newer one. Returns true iff this call
// actually removed the key (i.e. we were the live owner) — the caller pushes
// the offline frame only then.
const CLEAR_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
export async function clearPresent(threadId: string, nonce: string): Promise<boolean> {
  const deleted = (await redis().eval(CLEAR_IF_OWNER, 1, presenceKey(threadId), nonce)) as number;
  return deleted === 1;
}

export async function isPresent(threadId: string): Promise<boolean> {
  return (await redis().exists(presenceKey(threadId))) === 1;
}

// --- Turn lock: "is an in-process conversation turn running for this thread" --
// One in-process planning turn at a time, globally. A repo-less Hosted Thread
// has no Sandbox and no supervisor spawn-guard, so the serialization that the
// supervisor's `spawning` Set gives the VM path lives in Redis here instead —
// the same `SET NX EX` + owner-nonce CAS shape as presence above, so a crashed
// container's lock self-expires (TTL) and only the owner releases it.
const TURN_LOCK_PREFIX = 'tempo:turnlock:';
// Floor above the longest plausible single turn; the TTL is the crash safety
// net (a container that dies mid-turn must not wedge the thread forever). Sized
// for the worst case — MAX_STEPS_PER_TURN (50) steps fanning out to web search /
// fetch tools — so a slow-but-live turn never has its lock expire under it,
// which would let a second container start a duplicate turn.
const TURN_LOCK_TTL_SEC = 300;
function turnLockKey(threadId: string): string {
  return `${TURN_LOCK_PREFIX}${threadId}`;
}

// SET NX EX: claims the lock only if no other container holds it. Returns true
// iff we acquired it. A null reply means another container is already running a
// turn (and will re-drain), so the caller no-ops.
export async function acquireTurnLock(threadId: string, nonce: string): Promise<boolean> {
  const ok = await redis().set(turnLockKey(threadId), nonce, 'EX', TURN_LOCK_TTL_SEC, 'NX');
  return ok === 'OK';
}

// Compare-and-delete — releases only if the key still holds our nonce, so an
// expired-then-reacquired lock owned by another container is never evicted by
// our late release. Reuses the presence CAS script.
export async function releaseTurnLock(threadId: string, nonce: string): Promise<void> {
  await redis().eval(CLEAR_IF_OWNER, 1, turnLockKey(threadId), nonce);
}

// Batch presence read for the threads list — one MGET, present iff non-null.
export async function arePresent(threadIds: string[]): Promise<Map<string, boolean>> {
  if (threadIds.length === 0) return new Map();
  const values = await redis().mget(threadIds.map(presenceKey));
  return new Map(threadIds.map((id, i) => [id, values[i] != null]));
}
