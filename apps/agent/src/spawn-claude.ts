import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectToken, SessionId, ThreadId } from '@tempo/contracts';
import { env } from './env';
import { TempoError } from './errors';

// Bare TempoError (not a subclass) is deliberate: rule 11 — one adapter is
// hypothetical. There's one call site and no second variant of "the tool we
// shell out to is missing"; toDevMessage already prints the message verbatim.
const CLAUDE_MISSING_MESSAGE =
  "Couldn't find `claude` on PATH. Install Claude Code (https://claude.com/claude-code) and re-run.";

// In dev (TS source) the regex rewrites the sibling `spawn-claude.ts` path to
// `cli.ts`. In a bundled build the regex misses and the path is already
// `dist/cli.js`. Invariant: spawn-claude must remain a sibling of cli in the
// source tree (both writeMcpConfig and hookSettingsJson depend on this).
const CLI_PATH = fileURLToPath(import.meta.url).replace(/spawn-claude\.(ts|js)$/, 'cli.$1');

const TEMPO_TOOL_NAMES = [
  'mcp__tempo__tempo_attach',
  'mcp__tempo__tempo_pull_plan',
  'mcp__tempo__tempo_write_plan',
  'mcp__tempo__tempo_poll',
  'mcp__tempo__tempo_post_reply',
  'mcp__tempo__tempo_post_discussion_message',
  // ScheduleWakeup powers the polling-loop heartbeat described in the
  // workflow field of the tempo_attach response: the Agent schedules its own
  // re-wake every ~30s so Comments arriving while it's idle get picked up
  // between Stop-hook long-poll windows.
  'ScheduleWakeup',
];

export async function spawnInteractiveClaude(args: {
  initialPrompt: string;
  sessionId: SessionId;
  threadId: ThreadId;
  token: ConnectToken;
  cursorFile: string;
}): Promise<number> {
  const configPath = writeMcpConfig(args);

  // stdio:'inherit' shares the TTY's process group, so Ctrl-C reaches claude
  // directly; the parent must not exit until the child does or finally-cleanup
  // races the child's shutdown.
  const onSigint = (): void => {};
  process.on('SIGINT', onSigint);

  try {
    return await runChild(args.initialPrompt, configPath, {
      TEMPO_CONNECT_TOKEN: args.token,
      TEMPO_SESSION_ID: args.sessionId,
      TEMPO_THREAD_ID: args.threadId,
      TEMPO_CONSOLE_URL: env.TEMPO_CONSOLE_URL,
      TEMPO_CURSOR_FILE: args.cursorFile,
    });
  } finally {
    process.off('SIGINT', onSigint);
    rmSync(configPath, { force: true });
  }
}

function hookSettingsJson(): string {
  // PreToolUse hook: re-invokes this CLI as `hook-relay`, which reads the
  // payload from stdin and POSTs a one-line summary to the Console.
  //
  // Stop hook: re-invokes as `stop-hook`, which long-polls the Console for
  // new events and blocks the stop (with `decision: "block"` + an
  // `additionalContext` nudge) if any arrived. Timeout is 30s — slightly
  // above the 25s long-poll wait so the hook returns its JSON before Claude
  // kills it.
  //
  // PostToolBatch hook (A/B, gated by TEMPO_MIDTURN_HOOK=1): re-invokes as
  // `post-tool-batch-hook`, which polls with wait=0 and emits
  // `additionalContext` so new Comments land mid-turn. Default off —
  // turning it off restores today's Stop-hook-only behavior exactly.
  //
  // All inlined via `--settings` (Claude accepts file path or JSON string)
  // so there's nothing to clean up. Matcher "*" covers every tool name.
  const command = (sub: string) =>
    `${shellEscape(process.execPath)} ${shellEscape(CLI_PATH)} ${sub}`;
  const hooks: Record<string, unknown> = {
    PreToolUse: [
      {
        matcher: '*',
        hooks: [{ type: 'command', command: command('hook-relay'), timeout: 2 }],
      },
    ],
    Stop: [
      {
        matcher: '*',
        hooks: [{ type: 'command', command: command('stop-hook'), timeout: 30 }],
      },
    ],
  };
  if (process.env.TEMPO_MIDTURN_HOOK === '1') {
    hooks.PostToolBatch = [
      {
        matcher: '*',
        hooks: [{ type: 'command', command: command('post-tool-batch-hook'), timeout: 2 }],
      },
    ];
  }
  return JSON.stringify({ hooks });
}

function shellEscape(s: string): string {
  // Single-quote and escape any embedded single quotes. Sufficient for paths
  // produced by Node/Bun on macOS/Linux; not a general-purpose escaper.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function writeMcpConfig(args: {
  sessionId: SessionId;
  threadId: ThreadId;
  token: ConnectToken;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'tempo-mcp-'));
  const path = join(dir, `config-${args.sessionId}.json`);

  const config = {
    mcpServers: {
      tempo: {
        type: 'stdio',
        command: process.execPath,
        args: [CLI_PATH, 'mcp-stdio'],
        env: {
          TEMPO_CONNECT_TOKEN: args.token,
          TEMPO_SESSION_ID: args.sessionId,
          TEMPO_THREAD_ID: args.threadId,
          TEMPO_CONSOLE_URL: env.TEMPO_CONSOLE_URL,
          TEMPO_LOG_TO_STDERR: '1',
        },
      },
    },
  };

  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  return path;
}

function runChild(
  initialPrompt: string,
  configPath: string,
  hookEnv: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '--mcp-config',
        configPath,
        '--settings',
        hookSettingsJson(),
        '--allowedTools',
        TEMPO_TOOL_NAMES.join(','),
        // `--` terminates the variadic --allowedTools so claude treats
        // the next arg as the positional `prompt`, not another tool name.
        '--',
        initialPrompt,
      ],
      { stdio: 'inherit', env: { ...process.env, ...hookEnv } },
    );

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new TempoError(CLAUDE_MISSING_MESSAGE));
        return;
      }
      reject(err);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
