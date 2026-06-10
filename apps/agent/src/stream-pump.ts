import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { AgentTodo, type Event, type SessionId, type ThreadId } from '@tempo/contracts';
import { z } from 'zod';
import { CANCEL_NOTICE, findCancelForSession } from './cancel';
import { bestEffortDisconnect, DISCONNECT_TIMEOUT_MS } from './disconnect-on-exit';
import { env } from './env';
import { createEventStream } from './event-stream';
import { ConsoleClient } from './http-client';
import { logger } from './logger';
import { writeMcpConfigFile } from './mcp-config';
import { buildNudge } from './nudge';
import { ALLOWED_TOOLS } from './prompts/allowed-tools';
import { INITIAL_PROMPT } from './prompts/initial-prompt';
import { writeAppendSystemPromptFile } from './prompts/system-prompt';
import { clip, summarizeToolInput } from './tool-summary';

const TEXT_MAX = 8000;
const SIGINT_TO_SIGKILL_MS = 5_000;
// Tail of stderr + non-JSON stdout we keep around to surface on non-zero
// exit. claude's auth / rate-limit / quota errors land here and would
// otherwise vanish silently.
const ERROR_TAIL_MAX = 4_000;
const TodosPayload = z.array(AgentTodo).max(50);

export async function runStreamPump(args: {
  sessionId: SessionId;
  threadId: ThreadId;
  agentApiKey: string;
}): Promise<number> {
  // Post-handshake: bearer is the workspace agent_api_key, session id is
  // pinned so every request carries X-Tempo-Session.
  const client = new ConsoleClient(env.TEMPO_CONSOLE_URL, args.agentApiKey, args.sessionId);
  const stream = createEventStream({ client, threadId: args.threadId });
  const { configPath, configDir } = writeMcpConfigFile({
    sessionId: args.sessionId,
    threadId: args.threadId,
    agentApiKey: args.agentApiKey,
  });
  const systemPromptPath = writeAppendSystemPromptFile(configDir);

  // claude's own session id, captured from the first `system:init` row and
  // re-used as `--resume` on subsequent spawns. Null until init lands; if a
  // turn crashes before init, the next spawn starts a fresh claude session and
  // loses prior in-memory context — acceptable for v1.
  let claudeSessionId: string | null = null;
  let state: 'IDLE' | 'RUNNING' = 'IDLE';
  let pending: Event[] = [];
  let currentChild: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let cancelled = false;
  let resolveExit: (code: number) => void = () => {};

  const cleanup = (): void => {
    rmSync(configDir, { force: true, recursive: true });
  };
  process.once('exit', cleanup);

  const onSigint = (): void => {
    stream.stop();
    // Fire-and-forget: bestEffortDisconnect has its own DISCONNECT_TIMEOUT_MS
    // abort ceiling. The exit timer is that ceiling + 100ms scheduler slack;
    // a hung Console must not strand the CLI past that bound.
    void bestEffortDisconnect({ sessionId: args.sessionId, agentApiKey: args.agentApiKey });
    setTimeout(() => {
      cleanup();
      process.exit(130);
    }, DISCONNECT_TIMEOUT_MS + 100).unref();
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigint);

  function drainAndSpawn(): void {
    const prompt = pending.length > 0 ? buildNudge(pending) : INITIAL_PROMPT;
    pending = [];
    if (!prompt) {
      state = 'IDLE';
      return;
    }
    state = 'RUNNING';
    // Reset on real re-engage so a second Stop after a fresh comment works.
    cancelled = false;
    const child = spawnClaude(configPath, systemPromptPath, claudeSessionId, prompt);
    currentChild = child;
    let errorTail = '';
    const captureError = (chunk: string): void => {
      errorTail = (errorTail + chunk).slice(-ERROR_TAIL_MAX);
    };
    pipeJsonl(
      child,
      args.sessionId,
      client,
      (sid) => {
        claudeSessionId = sid;
      },
      captureError,
    );
    child.once('exit', (code) => {
      state = 'IDLE';
      if (currentChild === child) currentChild = null;
      if (code !== 0) {
        logger.warn({ code, hasPending: pending.length > 0 }, 'claude exited non-zero');
        if (!cancelled) surfaceClaudeFailure(client, args.threadId, code, errorTail);
      } else {
        // End-of-turn signal — unmounts the Console's Activity widget.
        void post(client.postAgentTurnEnded(args.sessionId));
      }
      if (pending.length > 0) {
        drainAndSpawn();
      } else if (code !== 0) {
        resolveExit(code ?? 1);
      }
    });
    child.once('error', (err) => {
      logger.error({ err }, 'claude spawn failed');
      state = 'IDLE';
      resolveExit(1);
    });
  }

  return new Promise<number>((resolve) => {
    resolveExit = (code) => {
      stream.stop();
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigint);
      void bestEffortDisconnect({
        sessionId: args.sessionId,
        agentApiKey: args.agentApiKey,
      }).finally(() => resolve(code));
    };
    // Order matters: bootstrap first so `state = 'RUNNING'` is set before any
    // event-batch callback can fire and race a second `INITIAL_PROMPT` past
    // the empty-pending guard.
    drainAndSpawn();
    stream.start(async (events) => {
      if (!cancelled && findCancelForSession(events, args.sessionId)) {
        cancelled = true;
        await post(client.postDiscussionMessage(args.threadId, { text: CANCEL_NOTICE }));
        // Drop the in-flight queue so the child's exit doesn't immediately
        // respawn to drain events that arrived before the Dev hit Stop.
        // The CLI sits IDLE until a future event arrives in a later batch.
        pending = [];
        const c = currentChild;
        if (c) {
          c.kill('SIGINT');
          setTimeout(() => c.kill('SIGKILL'), SIGINT_TO_SIGKILL_MS).unref();
        }
        return;
      }
      pending.push(...events);
      if (state === 'IDLE') drainAndSpawn();
    });
  });
}

function spawnClaude(
  configPath: string,
  systemPromptPath: string,
  resumeSessionId: string | null,
  prompt: string,
): ChildProcessByStdio<null, Readable, Readable> {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    env.TEMPO_AGENT_MODEL,
    '--mcp-config',
    configPath,
    '--append-system-prompt-file',
    systemPromptPath,
    '--allowedTools',
    ALLOWED_TOOLS.join(','),
  ];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  args.push('--', prompt);
  return spawn('claude', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // CLI v2.1.142+ defaults to the Task tools (TaskCreate/...) which would
    // split a TodoWrite call into per-item events keyed by taskId — server
    // state accumulation we haven't built.
    env: { ...process.env, CLAUDE_CODE_ENABLE_TASKS: '0' },
  });
}

function pipeJsonl(
  child: ChildProcessByStdio<null, Readable, Readable>,
  sessionId: SessionId,
  client: ConsoleClient,
  onClaudeSessionId: (sid: string) => void,
  captureError: (chunk: string) => void,
): void {
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      // Plain-text on stdout means claude bailed before JSONL — keep the
      // line so the exit handler can surface it (e.g. "Not logged in").
      captureError(`${line}\n`);
      return;
    }
    handleMessage(msg, sessionId, client, onClaudeSessionId);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    captureError(text);
    logger.debug({ stderr: text }, 'claude stderr');
  });
}

function surfaceClaudeFailure(
  client: ConsoleClient,
  threadId: ThreadId,
  code: number | null,
  tail: string,
): void {
  const trimmed = tail.trim();
  const header = `agent failed (exit ${code ?? '?'})`;
  // Dev terminal: write loud so a Dev who started the CLI from a shell
  // sees the actual reason (login required, rate limit, etc.).
  if (trimmed) {
    process.stderr.write(`\n${header}:\n${trimmed}\n\n`);
  } else {
    process.stderr.write(`\n${header} (no stderr captured)\n\n`);
  }
  // Console Discussion: same content, fenced so it renders verbatim. Gives
  // the Dev the failure reason even when they're driving from the UI.
  const body = trimmed
    ? `**${header}**\n\n\`\`\`\n${trimmed}\n\`\`\``
    : `**${header}** (no stderr captured)`;
  void post(client.postDiscussionMessage(threadId, { text: body }));
}

type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: string };

function handleMessage(
  msg: unknown,
  sessionId: SessionId,
  client: ConsoleClient,
  onClaudeSessionId: (sid: string) => void,
): void {
  if (typeof msg !== 'object' || msg === null) return;
  const m = msg as Record<string, unknown>;
  if (m.type === 'system') {
    if (m.subtype === 'init' && typeof m.session_id === 'string') {
      onClaudeSessionId(m.session_id);
    }
    return; // hook_* / rate_limit_event / other system noise
  }
  if (m.type !== 'assistant') return;
  const inner = m.message as Record<string, unknown> | undefined;
  const content = Array.isArray(inner?.content) ? (inner.content as AssistantContentBlock[]) : [];
  for (const block of content) {
    if (block.type === 'text' && 'text' in block && block.text.trim()) {
      void post(client.postAgentNarration(sessionId, clip(block.text, TEXT_MAX)));
    } else if (block.type === 'tool_use' && 'name' in block) {
      // Invalid TodoWrite payloads fall through so the tool-use signal isn't dropped.
      if (block.name === 'TodoWrite') {
        const raw =
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>).todos
            : undefined;
        const parsed = TodosPayload.safeParse(raw);
        if (parsed.success) {
          void post(client.postAgentTodosUpdated(sessionId, parsed.data));
          continue;
        }
      }
      void post(client.postAgentToolUse(sessionId, block.name, summarizeToolInput(block.input)));
    }
  }
}

async function post(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    // A dropped narration/tool-use event leaves a gap in the Console activity
    // feed — observable to the Dev, so log loud enough to show up in prod.
    logger.warn({ err }, 'console post failed');
  }
}
