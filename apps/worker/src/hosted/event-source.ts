// Persistent SSE connection to the Worker's Redis-backed event stream.
// The hosted runner (inside the E2B sandbox) cannot reach Redis directly —
// E2B's firewall only passes HTTP/TLS — so the Worker acts as the bridge.
//
// Shape: async iterator of Event values that passed `shouldWake`. The caller
// iterates until it breaks/returns, then passes its AbortSignal to stop
// reconnects. Reconnects automatically on stream end/error with a small
// backoff so transient Worker restarts don't kill the runner.

import type { Event } from '@tempo/contracts/events';
import { shouldWake } from '@tempo/contracts/events';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import pino from 'pino';

const logger = pino({ level: process.env.HOSTED_LOG_LEVEL ?? 'info' });

// Small, bounded backoff — don't hammer the Worker on repeated failures.
const RECONNECT_BACKOFF_MS = [250, 500, 1_000, 2_000, 5_000] as const;

function backoffMs(attempt: number): number {
  return RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 5_000;
}

// Opens the SSE stream and yields all wake events. On normal stream end or
// network error, waits `backoffMs(attempt)` and reconnects — unless the
// signal is aborted, which terminates the iterator cleanly.
export async function* wakeEvents(
  workerUrl: string,
  threadId: string,
  token: string,
  signal: AbortSignal,
): AsyncGenerator<Event> {
  const url = `${workerUrl}/api/threads/${threadId}/events`;
  let attempt = 0;

  while (!signal.aborted) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });

      if (!res.ok || !res.body) {
        logger.warn({ status: res.ok ? 'no_body' : res.status }, 'event-source: bad response');
        await delay(backoffMs(attempt++), signal);
        continue;
      }

      attempt = 0; // stream opened OK — reset backoff counter

      const stream = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream());

      for await (const ev of stream) {
        if (signal.aborted) return;
        // Heartbeat frames have no data; skip them.
        if (!ev.data) continue;

        // Trust the write-boundary validation — events are Zod-checked at the
        // HTTP routes before they're streamed. A bad frame is skipped, not
        // fatal (matches the local CLI subscriber). Log length only: frame data
        // can carry user-authored text.
        let event: Event | null = null;
        try {
          const parsed = JSON.parse(ev.data) as Event;
          if (shouldWake(parsed)) event = parsed;
        } catch {
          logger.warn({ bytes: ev.data.length }, 'event-source: bad frame');
        }
        if (event) yield event;
      }

      // Stream ended normally (Worker closed it or restarted). Reconnect.
      logger.info('event-source: stream ended, reconnecting');
      await delay(backoffMs(attempt++), signal);
    } catch (err) {
      if (signal.aborted) return;
      // AbortError surfaces when the consumer breaks out of the for-await
      // after calling ctrl.abort() — treat it as a clean stop, not a
      // retriable failure.
      if (err instanceof Error && err.name === 'AbortError') return;
      logger.warn({ err }, 'event-source: fetch error, reconnecting');
      await delay(backoffMs(attempt++), signal);
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  // Already aborted — don't wait at all.
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    // Drop the listener on the normal-timeout path too, so reconnect cycles
    // don't accumulate abort listeners on the long-lived signal.
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
