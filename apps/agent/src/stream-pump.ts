import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { ThreadId } from '@tempo/contracts';
import { postLifecycleEvent } from './lifecycle';
import { logger, verbose } from './logger';

// Parse and forward claude's --output-format stream-json output to Worker's
// /api/agent-events. One JSON object per line; each line maps to one event
// kind from AgentEventRequest. Network retries live in `lifecycle.ts` so the
// same policy applies to lifecycle events the CLI posts directly.

type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: string };

export function startStreamPump(args: {
  stdout: Readable;
  threadId: ThreadId;
  token: string; // sk_user_*
  workerUrl: string;
  // Invoked once when claude emits its `system.init` line, carrying the
  // session_id we use for `--resume` on subsequent Turns. Optional — Turn
  // 1 needs it; nudged Turns already know the id.
  onSessionId?: (id: string) => void;
}): void {
  const { stdout, threadId, token, workerUrl, onSessionId } = args;

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
    if (onSessionId && isInitMessage(msg)) {
      onSessionId(msg.session_id);
    }
    handleMessage(msg, threadId, token, workerUrl);
  });
}

function isInitMessage(
  msg: unknown,
): msg is { type: 'system'; subtype: 'init'; session_id: string } {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string';
}

function handleMessage(msg: unknown, threadId: ThreadId, token: string, workerUrl: string): void {
  if (typeof msg !== 'object' || msg === null) return;
  const m = msg as Record<string, unknown>;

  if (m.type === 'assistant') {
    const inner = m.message as Record<string, unknown> | undefined;
    const content = Array.isArray(inner?.content) ? (inner.content as AssistantContentBlock[]) : [];
    for (const block of content) {
      if (block.type === 'text' && 'text' in block && block.text.trim()) {
        void postLifecycleEvent({
          workerUrl,
          token,
          threadId,
          event: { kind: 'agent_narration', text: block.text.slice(0, 8000) },
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
        void postLifecycleEvent({
          workerUrl,
          token,
          threadId,
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
                const todo: {
                  content: string;
                  status: 'pending' | 'in_progress' | 'completed';
                  activeForm?: string;
                } = { content, status };
                if (typeof o.activeForm === 'string') todo.activeForm = o.activeForm.slice(0, 500);
                return todo;
              })
              .filter(
                (
                  t,
                ): t is {
                  content: string;
                  status: 'pending' | 'in_progress' | 'completed';
                  activeForm?: string;
                } => t !== null,
              )
              .slice(0, 50);
            void postLifecycleEvent({
              workerUrl,
              token,
              threadId,
              event: { kind: 'agent_todos_updated', todos },
            });
          }
        }
      }
    }
    return;
  }

  if (m.type === 'result') {
    void postLifecycleEvent({
      workerUrl,
      token,
      threadId,
      event: { kind: 'agent_turn_ended' },
    });
  }
}

function summarizeInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'description']) {
    if (typeof obj[key] === 'string') return String(obj[key]).slice(0, 200);
  }
  return undefined;
}
