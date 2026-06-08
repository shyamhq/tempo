import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { ConnectToken, Event, SessionId, ThreadId } from '@tempo/contracts';
import { env } from './env';
import { createEventStream } from './event-stream';
import { ConsoleClient } from './http-client';
import { logger } from './logger';
import { writeMcpConfigFile } from './mcp-config';
import { buildNudge } from './nudge';
import { ALLOWED_TOOLS, INITIAL_PROMPT } from './pty-terminal';
import { clip, summarizeToolInput } from './tool-summary';

const TEXT_MAX = 8000;

// stream-json driver. Spawns `claude -p --output-format stream-json` per turn,
// walks each assistant message's content blocks, and forwards `text` blocks as
// `agent_narration` and `tool_use` blocks as `agent_tool_use`. No PTY, no TUI,
// no PreToolUse hook — the stream is the single source. Sessions are bound to
// one driver for life; cross-driver --resume is not supported.
export async function runStreamPump(args: {
  sessionId: SessionId;
  threadId: ThreadId;
  token: ConnectToken;
}): Promise<number> {
  const client = new ConsoleClient(env.TEMPO_CONSOLE_URL, args.token);
  const stream = createEventStream({ client, threadId: args.threadId });
  const { configPath, configDir } = writeMcpConfigFile({
    sessionId: args.sessionId,
    threadId: args.threadId,
    token: args.token,
  });

  // claude's own session id, captured from the first `system:init` row and
  // re-used as `--resume` on subsequent spawns. Null until init lands; if a
  // turn crashes before init, the next spawn starts a fresh claude session and
  // loses prior in-memory context — acceptable for v1.
  let claudeSessionId: string | null = null;
  let state: 'IDLE' | 'RUNNING' = 'IDLE';
  let pending: Event[] = [];
  let resolveExit: (code: number) => void = () => {};

  const cleanup = (): void => {
    rmSync(configDir, { force: true, recursive: true });
  };
  process.once('exit', cleanup);

  const onSigint = (): void => {
    stream.stop();
    cleanup();
    process.exit(130);
  };
  process.on('SIGINT', onSigint);

  function drainAndSpawn(): void {
    const prompt = pending.length > 0 ? buildNudge(pending) : INITIAL_PROMPT;
    pending = [];
    if (!prompt) {
      state = 'IDLE';
      return;
    }
    state = 'RUNNING';
    const child = spawnClaude(configPath, claudeSessionId, prompt);
    pipeJsonl(child, args.sessionId, client, (sid) => {
      claudeSessionId = sid;
    });
    child.once('exit', (code) => {
      state = 'IDLE';
      if (code !== 0) {
        logger.warn({ code, hasPending: pending.length > 0 }, 'claude exited non-zero');
      } else {
        // Parity with PTY's Stop hook — unmounts the Activity widget.
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
      resolve(code);
    };
    // Order matters: bootstrap first so `state = 'RUNNING'` is set before any
    // event-batch callback can fire and race a second `INITIAL_PROMPT` past
    // the empty-pending guard.
    drainAndSpawn();
    stream.start(async (events) => {
      pending.push(...events);
      if (state === 'IDLE') drainAndSpawn();
    });
  });
}

function spawnClaude(
  configPath: string,
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
    '--allowedTools',
    ALLOWED_TOOLS.join(','),
  ];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  args.push('--', prompt);
  return spawn('claude', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CODE_ENABLE_TASKS: '0' },
  });
}

function pipeJsonl(
  child: ChildProcessByStdio<null, Readable, Readable>,
  sessionId: SessionId,
  client: ConsoleClient,
  onClaudeSessionId: (sid: string) => void,
): void {
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    handleMessage(msg, sessionId, client, onClaudeSessionId);
  });
  // stderr is mostly noise in -p mode (auth refresh, telemetry); log at debug.
  child.stderr.on('data', (chunk) => {
    logger.debug({ stderr: chunk.toString() }, 'claude stderr');
  });
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
