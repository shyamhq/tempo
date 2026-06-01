import { type Event, type EventId, type ThreadId, ZERO_EVENT_CURSOR } from '@tempo/contracts';
import type { ConsoleClient } from './http-client';
import { logger } from './logger';

const POLL_WAIT_SECONDS = 25;
// 5s clock-drift threshold for the wake watchdog. Below 2s is false-positive
// territory under event-loop pressure; above 10s misses short sleeps.
const WAKE_DRIFT_MS = 5_000;
const WAKE_CHECK_MS = 1_000;
const RETRY_BACKOFF_MS = 1_000;

type EventStream = {
  start(onBatch: (events: Event[]) => Promise<void>): void;
  stop(): void;
};

export function createEventStream(args: {
  client: ConsoleClient;
  threadId: ThreadId;
}): EventStream {
  const { client, threadId } = args;
  const loopAbort = new AbortController();
  let pollAbort: AbortController | null = null;
  let wakeInterval: NodeJS.Timeout | null = null;

  return {
    start(onBatch) {
      let lastTick = Date.now();
      wakeInterval = setInterval(() => {
        const now = Date.now();
        if (now - lastTick > WAKE_DRIFT_MS) {
          logger.debug({ driftMs: now - lastTick }, 'wake detected — aborting in-flight poll');
          pollAbort?.abort(new Error('wake'));
        }
        lastTick = now;
      }, WAKE_CHECK_MS);

      void (async () => {
        let cursor: EventId = ZERO_EVENT_CURSOR;
        // First pass uses wait=0 and drops the result: it advances the cursor
        // past historical events that tempo_attach already delivered to Claude.
        let firstPass = true;

        while (!loopAbort.signal.aborted) {
          pollAbort = new AbortController();
          try {
            const waitSeconds = firstPass ? 0 : POLL_WAIT_SECONDS;
            const result = await client.poll(threadId, cursor, waitSeconds, pollAbort.signal);
            cursor = result.cursor;
            if (!firstPass && result.events.length > 0) {
              await onBatch(result.events);
            }
            firstPass = false;
          } catch (err) {
            if (loopAbort.signal.aborted) return;
            const isAbort =
              err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
            if (isAbort) continue;
            logger.debug({ err, firstPass }, 'poll error — backing off');
            await sleep(RETRY_BACKOFF_MS, loopAbort.signal);
          }
        }
      })();
    },
    stop() {
      loopAbort.abort();
      pollAbort?.abort();
      if (wakeInterval) {
        clearInterval(wakeInterval);
        wakeInterval = null;
      }
    },
  };
}

function sleep(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
