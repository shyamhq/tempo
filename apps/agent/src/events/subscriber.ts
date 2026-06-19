import { type Event, shouldWake } from '@tempo/contracts';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { logger } from '../logger';

const RECONNECT_DELAY_MS = 1000;
// Back off harder on auth failures so a persistently-rejected token doesn't
// hammer the Worker (and the refresh endpoint behind it) every second.
const AUTH_RETRY_DELAY_MS = 5000;

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
// Reconnects on drop until the signal aborts; resolves once stopped.
export async function runWakeSubscriber(opts: WakeSubscriberOptions): Promise<void> {
  const url = `${opts.workerUrl}/api/threads/${opts.threadId}/events`;

  while (!opts.signal.aborted) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${opts.getToken()}` },
        signal: opts.signal,
      });

      if (res.status === 401) {
        opts.onAuthError();
        await delay(AUTH_RETRY_DELAY_MS, opts.signal);
        continue;
      }
      if (!res.ok || !res.body) {
        logger.debug({ status: res.status }, 'wake-sse: bad response, retrying');
      } else {
        opts.onConnected?.();
        const frames = res.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream());
        for await (const frame of frames) {
          // One malformed frame must not tear down the whole connection — skip it.
          try {
            dispatch(frame.data, opts);
          } catch (err) {
            logger.debug({ err }, 'wake-sse: bad frame, skipping');
          }
        }
        // Stream ended (server closed / network) — fall through to reconnect.
      }
    } catch (err) {
      if (opts.signal.aborted) break;
      logger.debug({ err }, 'wake-sse: connection error, retrying');
    }
    await delay(RECONNECT_DELAY_MS, opts.signal);
  }
}

// Parse one SSE data payload and route it. Exported for unit testing.
export function dispatch(
  data: string,
  handlers: Pick<WakeSubscriberOptions, 'onWake' | 'onCancel'>,
): void {
  const event = parseEvent(data);
  if (!event) return;
  if (event.kind === 'agent_cancel_requested') handlers.onCancel();
  else if (shouldWake(event)) handlers.onWake(event);
}

export function parseEvent(data: string): Event | null {
  try {
    return JSON.parse(data) as Event;
  } catch {
    return null;
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    // Remove the listener on the normal-timeout path so reconnect cycles don't
    // accumulate abort listeners on the long-lived signal.
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
