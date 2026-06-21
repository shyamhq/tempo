import type { ThreadId, UIMessageChunk } from '@tempo/contracts';
import type { AgentEventRequest, AgentStreamRequest } from '@tempo/contracts/http';
import { logger } from './logger';

// The CLI's retry-aware POST wire to the Worker. One retry policy, one
// network-error log surface. 4xx is terminal (don't retry); only 5xx + network
// errors retry. Delays sit BETWEEN attempts — length+1 tries, no trailing sleep.
const RETRY_DELAYS_MS = [250, 500, 1000] as const;

async function postWithRetry(
  url: string,
  token: string,
  body: unknown,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        logger.debug({ label, status: res.status }, 'post');
        return;
      }
      // 4xx: auth/contract failure — retrying won't help, and silence hides misconfig.
      if (res.status < 500) {
        logger.warn({ label, status: res.status }, 'post: client error, not retrying');
        return;
      }
      logger.debug({ label, status: res.status, attempt }, 'post: server error, retrying');
    } catch (err) {
      logger.debug({ label, err, attempt }, 'post: network error, retrying');
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await new Promise((r) => setTimeout(r, delay));
  }
  logger.warn({ label }, 'post: dropped after retries');
}

// Turn-boundary / lifecycle events (e.g. agent_turn_ended) → the event log.
export async function postLifecycleEvent(args: {
  workerUrl: string;
  token: string;
  threadId: ThreadId;
  event: AgentEventRequest['event'];
}): Promise<void> {
  const { workerUrl, token, threadId, event } = args;
  const body: AgentEventRequest = { thread_id: threadId, event };
  await postWithRetry(`${workerUrl}/api/agent-events`, token, body, `event:${event.kind}`);
}

// A turn's UIMessageChunk batch → the agent-stream ingest. `done` marks the final
// flush, triggering terminal persistence on the Worker.
export async function postAgentChunks(args: {
  workerUrl: string;
  token: string;
  threadId: ThreadId;
  turn: string;
  chunks: UIMessageChunk[];
  done?: boolean;
}): Promise<void> {
  const { workerUrl, token, threadId, turn, chunks, done } = args;
  if (chunks.length === 0 && !done) return;
  const body: AgentStreamRequest = { turn, chunks, done };
  await postWithRetry(`${workerUrl}/api/threads/${threadId}/agent-stream`, token, body, 'chunks');
}
