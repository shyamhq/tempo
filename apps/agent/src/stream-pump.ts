import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { ThreadId } from '@tempo/contracts';
import { logger, verbose } from './logger';

// Parse and forward claude's --output-format stream-json output to Worker's
// /api/agent-events. One JSON object per line; each line maps to one event
// kind from AgentEventRequest. POST failures are retried 3x with exponential
// backoff (250ms, 500ms, 1000ms) then dropped — a missed activity event is
// observable but never blocks the agent's progress.

const RETRY_DELAYS_MS = [250, 500, 1000] as const;

type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: string };

export function startStreamPump(args: {
  stdout: Readable;
  threadId: ThreadId;
  token: string; // sk_user_*
  workerUrl: string;
}): void {
  const { stdout, threadId, token, workerUrl } = args;

  const rl = createInterface({ input: stdout });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      // claude bailed before emitting JSON — not an event we can forward.
      logger.debug({ line }, 'stream-pump: non-JSON stdout line');
      return;
    }
    if (verbose) {
      const m = msg as Record<string, unknown>;
      logger.debug({ type: m.type, subtype: m.subtype }, 'claude line');
    }
    handleMessage(msg, threadId, token, workerUrl);
  });
}

function handleMessage(msg: unknown, threadId: ThreadId, token: string, workerUrl: string): void {
  if (typeof msg !== 'object' || msg === null) return;
  const m = msg as Record<string, unknown>;

  if (m.type === 'assistant') {
    const inner = m.message as Record<string, unknown> | undefined;
    const content = Array.isArray(inner?.content) ? (inner.content as AssistantContentBlock[]) : [];
    for (const block of content) {
      if (block.type === 'text' && 'text' in block && block.text.trim()) {
        void postEvent(workerUrl, token, {
          thread_id: threadId,
          event: {
            kind: 'agent_narration',
            text: block.text.slice(0, 8000),
          },
        });
      } else if (block.type === 'tool_use' && 'name' in block) {
        // Verbose trace: every tempo MCP call. Claude prefixes MCP tools with
        // `mcp__<server>__<tool>` — surface just the bare tool name.
        if (block.name.startsWith('mcp__tempo__')) {
          logger.debug(
            { tool: block.name.replace(/^mcp__tempo__/, ''), input: block.input },
            'tempo call',
          );
        }
        void postEvent(workerUrl, token, {
          thread_id: threadId,
          event: {
            kind: 'agent_tool_use',
            tool: block.name.slice(0, 64),
            summary: (summarizeInput(block.input) ?? '').slice(0, 200),
          },
        });

        // TodoWrite → agent_todos_updated. Map each entry to the AgentTodo
        // shape Console renders: { content, status, activeForm? }.
        if (block.name === 'TodoWrite') {
          const raw =
            block.input && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>).todos
              : undefined;
          if (Array.isArray(raw)) {
            const todos = raw
              .map((t) => {
                if (!t || typeof t !== 'object') return null;
                const o = t as Record<string, unknown>;
                const content = typeof o.content === 'string' ? o.content.slice(0, 500) : null;
                const status =
                  o.status === 'pending' || o.status === 'in_progress' || o.status === 'completed'
                    ? o.status
                    : null;
                if (!content || !status) return null;
                const todo: { content: string; status: string; activeForm?: string } = {
                  content,
                  status,
                };
                if (typeof o.activeForm === 'string') todo.activeForm = o.activeForm.slice(0, 500);
                return todo;
              })
              .filter(
                (t): t is { content: string; status: string; activeForm?: string } => t !== null,
              )
              .slice(0, 50);
            void postEvent(workerUrl, token, {
              thread_id: threadId,
              event: { kind: 'agent_todos_updated', todos },
            });
          }
        }
      }
    }
    return;
  }

  if (m.type === 'result') {
    void postEvent(workerUrl, token, {
      thread_id: threadId,
      event: { kind: 'agent_turn_ended' },
    });
  }
}

function summarizeInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  // Prefer the most semantically useful fields
  for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'description']) {
    if (typeof obj[key] === 'string') return String(obj[key]).slice(0, 200);
  }
  return undefined;
}

async function postEvent(
  workerUrl: string,
  token: string,
  body: Record<string, unknown>,
): Promise<void> {
  // RETRY_DELAYS_MS controls inter-attempt sleeps; total attempts = length.
  // attempt = 0..length-1 inclusive; delay applied at end of each iteration
  // except the last (no sleep after the final attempt before dropping).
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
        logger.debug(
          { kind: (body.event as Record<string, unknown>)?.kind, status: res.status },
          'event',
        );
        return; // 4xx are client errors — don't retry
      }
      logger.debug({ status: res.status, attempt }, 'stream-pump: server error, will retry');
    } catch (err) {
      logger.debug({ err, attempt }, 'stream-pump: network error, will retry');
    }
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by loop guard
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
  // Drop after final failure — don't block the agent.
  logger.warn(
    { event: (body.event as Record<string, unknown>)?.kind },
    `stream-pump: dropped event after ${RETRY_DELAYS_MS.length} failures`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
