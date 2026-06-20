import { EventSource } from 'eventsource';

// Delay before recreating a connection the library gave up on (see below).
// Matches eventsource's own default reconnect interval.
const RECREATE_DELAY_MS = 3000;

export interface SseSubscription {
  close(): void;
}

export interface SubscribeOptions {
  url: string;
  // Read on every (re)connect so a refreshed token is always sent.
  getToken: () => string | Promise<string>;
  // Parsed JSON of each frame. Empty (heartbeat) and malformed frames are skipped.
  onMessage: (data: unknown) => void;
  // `reconnected` is false on the first open, true on every open after a drop.
  onOpen?: (reconnected: boolean) => void;
  // HTTP status of a connection error (e.g. 401), or undefined for a network drop.
  onError?: (status: number | undefined) => void;
  // Abort -> close().
  signal?: AbortSignal;
}

// The repo's single SSE consumer. Wraps the `eventsource` package, which injects
// a Bearer token via a custom fetch and natively reconnects mid-stream drops
// (resuming via Last-Event-ID). Server frames carry no `event:` field, so routing
// is left to callers via the parsed `data.kind`.
//
// One gap the library leaves (per the SSE spec): a non-200 response — a 401 from
// an expired token, a 503 during a deploy, a failed first connect — is fatal; it
// goes to CLOSED and never retries. For a long-lived authed stream that's a silent
// death, so we recreate it when it lands CLOSED. A fresh EventSource re-runs the
// custom fetch and picks up a refreshed token. Network drops stay CONNECTING and
// are left to the library.
export function subscribeToEvents(opts: SubscribeOptions): SseSubscription {
  let es: EventSource | null = null;
  let opened = false;
  let stopped = false;
  let recreateTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    es = new EventSource(opts.url, {
      fetch: async (input, init) => {
        const token = await opts.getToken();
        return fetch(input, {
          ...init,
          headers: { ...init?.headers, Authorization: `Bearer ${token}` },
        });
      },
    });

    es.addEventListener('open', () => {
      opts.onOpen?.(opened);
      opened = true;
    });
    es.addEventListener('message', (ev) => {
      if (!ev.data) return;
      try {
        opts.onMessage(JSON.parse(ev.data));
      } catch {
        // skip malformed frame
      }
    });
    es.addEventListener('error', (ev) => {
      opts.onError?.((ev as { code?: number }).code);
      // CLOSED means the library failed a non-200 and won't retry — recreate it.
      // CONNECTING means it's already reconnecting a dropped stream; leave it be.
      if (!stopped && es?.readyState === EventSource.CLOSED) {
        recreateTimer = setTimeout(connect, RECREATE_DELAY_MS);
      }
    });
  };

  const close = () => {
    stopped = true;
    clearTimeout(recreateTimer);
    es?.close();
  };

  if (opts.signal?.aborted) stopped = true;
  else opts.signal?.addEventListener('abort', close, { once: true });
  if (!stopped) connect();

  return { close };
}
