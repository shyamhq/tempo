import { rmSync } from 'node:fs';
import type { ConnectToken, SessionId, ThreadId } from '@tempo/contracts';
import { spawn as ptySpawn } from 'node-pty';
import { env } from './env';
import { TempoError } from './errors';
import { CLI_PATH, writeMcpConfigFile } from './mcp-config';

const CLAUDE_MISSING_MESSAGE =
  "Couldn't find `claude` on PATH. Install Claude Code (https://claude.com/claude-code) and re-run.";

// Tools the Agent needs in pty mode. ScheduleWakeup is absent — Node owns the
// loop heartbeat. tempo_poll *is* allowed because the Agent calls it to fetch
// event payloads after Node nudges it. Edit/Write/MultiEdit are absent because
// the Plan is written via tempo_write_plan, never to disk.
export const ALLOWED_TOOLS = [
  'mcp__tempo__tempo_attach',
  'mcp__tempo__tempo_pull_plan',
  'mcp__tempo__tempo_update_plan',
  'mcp__tempo__tempo_update_block',
  'mcp__tempo__tempo_add_blocks',
  'mcp__tempo__tempo_delete_block',
  'mcp__tempo__tempo_poll',
  'mcp__tempo__tempo_post_reply',
  'mcp__tempo__tempo_post_discussion_message',
  'mcp__tempo__tempo_set_thread_meta',
  'Read',
  'Glob',
  'Grep',
  'Bash',
];

export const INITIAL_PROMPT = 'Call tempo_attach to begin.';

const SIGINT_TO_SIGKILL_MS = 5_000;
// Gap between nudge text and the trailing `\r`. Without it, Claude's ink
// composer treats the burst as one paste and the CR lands as text.
const ENTER_KEY_DELAY_MS = 120;

type Terminal = {
  inject(text: string): Promise<void>;
  onExit(handler: (exitCode: number) => void): void;
};

export function spawnTerminal(args: {
  sessionId: SessionId;
  threadId: ThreadId;
  token: ConnectToken;
}): Terminal {
  const { configPath, configDir } = writeMcpConfigFile({
    sessionId: args.sessionId,
    threadId: args.threadId,
    token: args.token,
  });

  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;

  let child: ReturnType<typeof ptySpawn>;
  try {
    child = ptySpawn(
      'claude',
      [
        '--mcp-config',
        configPath,
        '--settings',
        HOOK_SETTINGS_JSON,
        '--allowedTools',
        ALLOWED_TOOLS.join(','),
        // `--` terminates --allowedTools so the next arg is the positional
        // prompt, not another tool name.
        '--',
        INITIAL_PROMPT,
      ],
      {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEMPO_CONNECT_TOKEN: args.token,
          TEMPO_SESSION_ID: args.sessionId,
          TEMPO_THREAD_ID: args.threadId,
          TEMPO_CONSOLE_URL: env.TEMPO_CONSOLE_URL,
          // Keep Claude on TodoWrite. As of CLI v2.1.142+ the default is the
          // Task tools (TaskCreate/TaskUpdate/TaskGet/TaskList), which split a
          // single TodoWrite call into per-item events keyed by taskId — that
          // would need server-side state accumulation we haven't built yet.
          CLAUDE_CODE_ENABLE_TASKS: '0',
        } as Record<string, string>,
      },
    );
  } catch (err) {
    rmSync(configDir, { force: true, recursive: true });
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TempoError(CLAUDE_MISSING_MESSAGE);
    }
    throw err;
  }

  child.onData((data) => process.stdout.write(data));

  const stdinIsTty = process.stdin.isTTY === true;
  const onStdinData = (chunk: Buffer): void => {
    child.write(chunk.toString('utf8'));
  };
  if (stdinIsTty) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onStdinData);
  }

  const onResize = (): void => {
    child.resize(process.stdout.columns ?? cols, process.stdout.rows ?? rows);
  };
  process.stdout.on('resize', onResize);

  // In raw mode the terminal driver doesn't translate Ctrl-C to SIGINT — it
  // arrives as 0x03 on stdin and flows to Claude. This handler only catches
  // signals from outside the TTY (kill -INT, parent shell).
  const onSigint = (): void => {
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), SIGINT_TO_SIGKILL_MS).unref();
  };
  process.on('SIGINT', onSigint);

  // Backstop the natural cleanup path (child.onExit → cleanup). Covers graceful
  // parent exit before the child exits — uncaught exception, SIGTERM, normal
  // termination. SIGKILL is unfixable; that path leaks the tempdir under TMPDIR.
  const onProcessExit = (): void => {
    rmSync(configDir, { force: true, recursive: true });
  };
  process.once('exit', onProcessExit);

  const cleanup = (): void => {
    process.off('SIGINT', onSigint);
    process.off('exit', onProcessExit);
    process.stdout.off('resize', onResize);
    if (stdinIsTty) {
      process.stdin.off('data', onStdinData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // stdin may already be closed if the terminal went away.
      }
      process.stdin.pause();
    }
    rmSync(configDir, { force: true, recursive: true });
  };

  return {
    async inject(text) {
      child.write(text);
      await new Promise<void>((resolve) => setTimeout(resolve, ENTER_KEY_DELAY_MS));
      child.write('\r');
    },
    onExit(handler) {
      child.onExit(({ exitCode }) => {
        cleanup();
        handler(exitCode);
      });
    },
  };
}

// Inline settings JSON: PreToolUse → hook-relay (per-tool live activity);
// Stop → stop-hook (clears spinner at end-of-turn). Both are fire-and-forget
// to the Console; the loop is still Node-owned.
const HOOK_SETTINGS_JSON = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `${shellEscape(process.execPath)} ${shellEscape(CLI_PATH)} hook-relay`,
            timeout: 2,
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `${shellEscape(process.execPath)} ${shellEscape(CLI_PATH)} stop-hook`,
            timeout: 2,
          },
        ],
      },
    ],
  },
});

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
