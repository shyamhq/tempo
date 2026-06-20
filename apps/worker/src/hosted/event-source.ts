// Persistent SSE connection to the Worker's Redis-backed event stream.
// The hosted runner (inside the E2B sandbox) cannot reach Redis directly —
// E2B's firewall only passes HTTP/TLS — so the Worker acts as the bridge.
// Delivers each human wake event to onWake; @tempo/sse-client owns the transport.

import type { Event } from '@tempo/contracts/events';
import { shouldWake } from '@tempo/contracts/events';
import { subscribeToEvents } from '@tempo/sse-client';

export interface WakeSubscriberOptions {
  workerUrl: string;
  threadId: string;
  token: string;
  signal: AbortSignal;
  // A human-authored event the runner should wake on. Agent echoes never reach here.
  onWake: (event: Event) => void;
}

export function runWakeSubscriber(opts: WakeSubscriberOptions): Promise<void> {
  return new Promise((resolve) => {
    subscribeToEvents({
      url: `${opts.workerUrl}/api/threads/${opts.threadId}/events`,
      getToken: () => opts.token,
      onMessage: (d) => {
        const e = parseWakeEvent(d);
        if (e) opts.onWake(e);
      },
      signal: opts.signal,
    });
    opts.signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

// Classify a parsed frame as a wake Event, or null for a non-wake event.
// Pure — unit-tested without a live stream. Trusts the write-boundary
// validation (events are Zod-checked at the HTTP routes before streaming).
export function parseWakeEvent(event: unknown): Event | null {
  const ev = event as Event;
  return ev?.kind && shouldWake(ev) ? ev : null;
}
