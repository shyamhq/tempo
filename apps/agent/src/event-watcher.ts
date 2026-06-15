import type { Event, EventKind, ThreadId } from '@tempo/contracts';
import { logger } from './logger';

// CLI-side SSE consumer for /api/threads/:id/events. Filters to the
// Dev-originated events that should wake a Turn; queues during a running
// Turn; drains the queue the instant the consumer asks for the next batch.
//
// Reconnect: native EventSource isn't available before Node 22 and won't
// carry an Authorization header on the request anyway, so we hand-roll
// the framing on top of `fetch`. Reconnect with `?cursor=<lastSeen>` so
// no event is skipped across a transient drop.
//
// `agent_*`/`session_*`/`plan_edited_by_agent`/`thread_renamed` are all
// filtered OUT by kind — those originate from the very Claude run we
// just spawned, or are echoes of our own writes. Waking on them would
// loop forever. `agent_cancel_requested` is Dev-originated but cancel is
// handled in-Turn via its own path (SIGINT-equivalent), not via a
// re-spawn — so it stays out of the wake set deliberately.
//
// `reply_added` and `discussion_message_posted` are kind-allowed but
// MUST be author-filtered: both Dev and Agent emit them, and waking on
// the Agent's own reply causes a ping-pong loop.
const WAKE_KINDS = new Set<EventKind>([
  'comment_added',
  'reply_added',
  'comment_resolved',
  'comment_unresolved',
  'comment_deleted',
  'discussion_message_posted',
  'plan_edited_by_dev',
  'status_changed',
]);

function shouldWake(event: Event): boolean {
  if (!WAKE_KINDS.has(event.kind)) return false;
  if (event.kind === 'reply_added') return event.reply.author === 'dev';
  if (event.kind === 'discussion_message_posted') return event.message.author === 'dev';
  return true;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const WARN_AFTER_FAILS = 3;

export type EventBatch = {
  events: Event[];
  // Cursor "before" this batch — i.e., the latest event id Claude has
  // already seen (initial: from /access; afterwards: id of the previous
  // batch's last event). Goes into the nudge verbatim.
  priorCursor: string;
  // Cursor "after" this batch — id of the last event in `events`. Stored
  // as the next batch's priorCursor.
  newCursor: string;
};

export type EventWatcher = {
  next: () => Promise<EventBatch>;
  close: () => void;
};

export function startEventWatcher(args: {
  workerUrl: string;
  getToken: () => string;
  onTokenExpired: () => Promise<string>; // returns refreshed sk_user_*
  threadId: ThreadId;
  initialCursor: string;
}): EventWatcher {
  const { workerUrl, getToken, onTokenExpired, threadId, initialCursor } = args;

  const queue: Event[] = [];
  let cursor = initialCursor;
  let pendingResolve: ((batch: EventBatch) => void) | null = null;
  let closed = false;
  let abortCurrent: AbortController | null = null;

  const drain = (): EventBatch | null => {
    if (queue.length === 0) return null;
    const events = queue.splice(0, queue.length);
    const last = events[events.length - 1];
    if (!last) return null; // unreachable; satisfies noUncheckedIndexedAccess
    const priorCursor = cursor;
    cursor = last.id;
    return { events, priorCursor, newCursor: last.id };
  };

  const onEvent = (event: Event) => {
    if (!shouldWake(event)) return;
    queue.push(event);
    if (pendingResolve) {
      const batch = drain();
      if (batch) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve(batch);
      }
    }
  };

  // Outer reconnect loop — runs until close() flips `closed`.
  const loop = async (): Promise<void> => {
    let backoffMs = MIN_BACKOFF_MS;
    let consecutiveFails = 0;
    while (!closed) {
      abortCurrent = new AbortController();
      let token = getToken();
      try {
        const url = `${workerUrl}/api/threads/${threadId}/events?cursor=${encodeURIComponent(cursor)}`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: abortCurrent.signal,
        });
        if (res.status === 401) {
          logger.debug('event-watcher: 401, refreshing token');
          token = await onTokenExpired();
          continue;
        }
        if (!res.ok || !res.body) {
          throw new Error(`SSE response not ok: ${res.status}`);
        }
        consecutiveFails = 0;
        backoffMs = MIN_BACKOFF_MS;
        await readSseFrames(res.body, onEvent);
        // Normal disconnect — reconnect.
      } catch (err) {
        if (closed) return;
        consecutiveFails += 1;
        if (consecutiveFails === WARN_AFTER_FAILS) {
          process.stderr.write('tempo: lost connection to Worker; will keep retrying...\n');
        }
        logger.debug({ err, consecutiveFails }, 'event-watcher: stream error');
      }
      if (closed) return;
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  };

  void loop();

  return {
    next: () => {
      if (closed) return Promise.reject(new Error('watcher closed'));
      const batch = drain();
      if (batch) return Promise.resolve(batch);
      return new Promise<EventBatch>((resolve) => {
        pendingResolve = resolve;
      });
    },
    close: () => {
      closed = true;
      abortCurrent?.abort();
      if (pendingResolve) {
        const reject = pendingResolve;
        pendingResolve = null;
        // Resolve with an empty-cursor batch to unblock any awaiter cleanly.
        reject({ events: [], priorCursor: cursor, newCursor: cursor });
      }
    },
  };
}

// Minimal SSE frame parser — only `event:`, `data:`, `id:` lines, blank
// line ends frame, `:` lines are comments (heartbeats).
async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Event) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      while (true) {
        const frameEnd = buf.indexOf('\n\n');
        if (frameEnd < 0) break;
        const frame = buf.slice(0, frameEnd);
        buf = buf.slice(frameEnd + 2);
        let kind: string | null = null;
        let data = '';
        for (const raw of frame.split('\n')) {
          if (raw.startsWith(':')) continue;
          if (raw.startsWith('event:')) {
            kind = raw.slice(6).replace(/^ /, '');
          } else if (raw.startsWith('data:')) {
            // Per the SSE spec, multiple `data:` lines in one frame are
            // joined with '\n'; a single leading space after the colon is
            // stripped, but other whitespace is preserved.
            const segment = raw.slice(5).replace(/^ /, '');
            data += data ? `\n${segment}` : segment;
          }
          // `id:` lines aren't emitted by Worker today; cursor lives in payload.
        }
        // `presence` frames have kind='presence' and aren't wake events.
        if (!kind || kind === 'presence' || !data) continue;
        try {
          const parsed = JSON.parse(data) as Event;
          onEvent(parsed);
        } catch (err) {
          logger.debug({ err, kind }, 'event-watcher: bad event payload');
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
