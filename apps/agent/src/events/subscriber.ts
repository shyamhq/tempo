import { type Event, shouldWake } from '@tempo/contracts';
import { subscribeToEvents } from '@tempo/sse-client';
import { logger } from '../logger';

export interface WakeSubscriberOptions {
  threadId: string;
  workerUrl: string;
  // Read on every (re)connect so a token refresh is picked up without
  // restarting the subscriber.
  getToken: () => string;
  // Stop the subscriber (connection is torn down, loop resolves).
  signal: AbortSignal;
  // A human-authored event (comment/reply/discussion message) the agent should
  // wake on. Echoes of the agent's own activity never reach here.
  onWake: (event: Event) => void;
  // Dev pressed "Stop" on the Thread — cancel the in-flight turn, don't re-prompt.
  onCancel: () => void;
  // The token was rejected (401) — the connect loop should refresh it.
  onAuthError: () => void;
  // A stream opened successfully — lets the loop reset its auth-failure count.
  onConnected?: () => void;
}

// Tail the Worker's SSE event feed for a Thread and classify each event:
//   human wake (shouldWake)          -> onWake
//   agent_cancel_requested (Stop)    -> onCancel
//   anything else (our own echoes)   -> ignored
// The transport (@tempo/sse-client) reconnects on drop natively; the signal
// stops it (the returned promise resolves once aborted).
export function runWakeSubscriber(opts: WakeSubscriberOptions): Promise<void> {
  return new Promise((resolve) => {
    subscribeToEvents({
      url: `${opts.workerUrl}/api/threads/${opts.threadId}/events`,
      getToken: opts.getToken,
      onMessage: (d) => dispatch(d, opts),
      onOpen: () => opts.onConnected?.(),
      onError: (code) => {
        if (code === 401) opts.onAuthError();
        else logger.debug({ code }, 'wake-sse: connection error, retrying');
      },
      signal: opts.signal,
    });
    opts.signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

// Route one parsed event. Exported for unit testing — pure, no I/O.
export function dispatch(
  event: unknown,
  handlers: Pick<WakeSubscriberOptions, 'onWake' | 'onCancel'>,
): void {
  const ev = event as Event;
  if (!ev?.kind) return;
  if (ev.kind === 'agent_cancel_requested') handlers.onCancel();
  else if (shouldWake(ev)) handlers.onWake(ev);
}
