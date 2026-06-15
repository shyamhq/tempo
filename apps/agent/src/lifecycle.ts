import type { ThreadId } from '@tempo/contracts';
import type { AgentEventRequest } from '@tempo/contracts/http';
import { logger } from './logger';

// Shared retry-aware POST for the CLI's event-stream wire. Used by
// stream-pump (forwarding claude's narrations + tool calls) and connect.ts
// (lifecycle: session_initiating / session_failed). One helper means one
// retry policy — and one network-error log surface to grep.

const RETRY_DELAYS_MS = [250, 500, 1000] as const;

export async function postLifecycleEvent(args: {
  workerUrl: string;
  token: string;
  threadId: ThreadId;
  event: AgentEventRequest['event'];
}): Promise<void> {
  const { workerUrl, token, threadId, event } = args;
  const body: AgentEventRequest = { thread_id: threadId, event };

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${workerUrl}/api/agent-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok || res.status < 500) {
        logger.debug({ kind: event.kind, status: res.status }, 'event');
        return;
      }
      logger.debug({ status: res.status, attempt }, 'lifecycle: server error, retrying');
    } catch (err) {
      logger.debug({ err, attempt }, 'lifecycle: network error, retrying');
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  logger.warn({ kind: event.kind }, 'lifecycle: dropped after retries');
}
