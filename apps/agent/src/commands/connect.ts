import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThreadId } from '@tempo/contracts';
import { read, refresh } from '../credentials';
import { env } from '../env';
import { postLifecycleEvent } from '../lifecycle';
import { logger } from '../logger';
import { startStreamPump } from '../stream-pump';

// Seconds before token expiry at which we pre-emptively refresh
const REFRESH_BEFORE_EXPIRY_S = 60;

// The system prompt instructs the LLM to call tempo_attach first using the
// thread_id that was passed via the --print argument. Option (i) from
// slice-1c-2a plan: no slash command file needed.
const ATTACH_SYSTEM_PROMPT =
  'You are a Tempo planning agent. The --print argument contains a thread_id. ' +
  'Your FIRST action must be to call the tempo_attach MCP tool with that thread_id ' +
  'as the argument: tempo_attach({ thread_id: "<value from --print>" }). ' +
  'Do not read any files or perform any other action before calling tempo_attach.';

export async function connectCommand(rawThreadId: string | undefined): Promise<void> {
  if (!rawThreadId) {
    process.stderr.write('usage: tempo-agent connect <thread-id>\n');
    process.exit(2);
  }
  // Fail fast on a malformed id instead of round-tripping to Worker for a 404.
  // ThreadId is a Zod regex (^thr_[A-Z0-9]{26}$), so .parse() is the
  // single boundary check; the rest of this command can trust the value.
  const parsedThreadId = ThreadId.safeParse(rawThreadId);
  if (!parsedThreadId.success) {
    process.stderr.write(`tempo connect: "${rawThreadId}" is not a valid thread id\n`);
    process.exit(2);
  }
  const threadId = parsedThreadId.data;

  // 1. Read credentials
  let creds = await read().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

  // 2. Refresh if within 60 s of expiry
  const expiresAt = new Date(creds.expires_at).getTime();
  const nowMs = Date.now();
  if (expiresAt - nowMs < REFRESH_BEFORE_EXPIRY_S * 1000) {
    logger.debug({ expires_at: creds.expires_at }, 'token near expiry, refreshing');
    try {
      creds = await refresh(creds);
    } catch (err) {
      process.stderr.write(
        `tempo connect failed: could not refresh token — ${err instanceof Error ? err.message : String(err)}\n` +
          `Run \`tempo-agent init\` to re-authenticate.\n`,
      );
      process.exit(1);
    }
  }

  const workerUrl = creds.worker_url;
  const token = creds.token;

  // 3. Preflight — check thread access
  let accessRes: Response;
  try {
    accessRes = await fetch(`${workerUrl}/api/threads/${threadId}/access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    process.stderr.write(
      `tempo connect failed: could not reach Worker (${err instanceof Error ? err.message : String(err)})\n`,
    );
    process.exit(1);
  }

  if (accessRes.status === 404) {
    process.stderr.write(`tempo connect failed: thread "${threadId}" not found\n`);
    process.exit(1);
  }
  if (accessRes.status === 403) {
    const body = (await accessRes.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = body.error === 'not_a_member' ? 'not a member of this workspace' : 'forbidden';
    process.stderr.write(`tempo connect failed: ${reason}\n`);
    process.exit(1);
  }
  if (!accessRes.ok) {
    process.stderr.write(`tempo connect failed: unexpected error (HTTP ${accessRes.status})\n`);
    process.exit(1);
  }

  const access = (await accessRes.json()) as {
    thread_title: string;
    workspace_name: string;
  };
  process.stdout.write(
    `Connecting to ${access.workspace_name}'s Thread "${access.thread_title}"...\n`,
  );

  // Surface boot progress in Console before tempo_attach lands. The Console
  // reducer flips session_status to 'initiating' until session_connected
  // (from tempo_attach) overrides, or session_failed lands on early exit.
  await postLifecycleEvent({
    workerUrl,
    token,
    threadId,
    event: { kind: 'session_initiating' },
  });

  // 4. Write ephemeral MCP config (HTTP transport pointing at Worker)
  const suffix = randomBytes(4).toString('hex');
  const mcpConfigPath = join(tmpdir(), `tempo-${process.pid}-${suffix}.json`);
  const mcpConfig = {
    mcpServers: {
      tempo: {
        type: 'http',
        url: `${workerUrl}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
  await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  const cleanup = (): void => {
    try {
      // Best-effort synchronous unlink — async not available in process exit handlers
      unlinkSync(mcpConfigPath);
    } catch {
      // File may already be gone; ignore
    }
  };
  process.once('exit', cleanup);

  // 5. Spawn claude
  // --print passes the thread_id as the initial prompt; the system prompt
  // instructs the LLM to extract it and call tempo_attach first.
  const claudeArgs = [
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    env.TEMPO_AGENT_MODEL,
    '--mcp-config',
    mcpConfigPath,
    '--append-system-prompt',
    ATTACH_SYSTEM_PROMPT,
    '--print',
    threadId,
  ];

  logger.debug({ args: claudeArgs }, 'spawning claude');

  const child = spawn('claude', claudeArgs, {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, CLAUDE_CODE_ENABLE_TASKS: '0' },
  });

  // 6. Pipe stdout to stream-pump
  startStreamPump({
    stdout: child.stdout,
    threadId,
    token,
    workerUrl,
  });

  // 7. Handle SIGINT: kill child + clean up
  const onSignal = (): void => {
    logger.debug('SIGINT received — killing claude');
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  // Carries the failure reason out of the spawn-error handler so the
  // post-exit block can either await the in-flight POST or skip the
  // duplicate. process.exit() would otherwise abort an in-flight retry.
  let failedReason: string | null = null;

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      failedReason = `claude failed to spawn: ${err.message}`.slice(0, 200);
      process.stderr.write(
        `tempo connect: failed to spawn claude — ${err.message}\n` +
          `Make sure claude is installed: https://docs.anthropic.com/en/docs/claude-code\n`,
      );
      resolve(1);
    });
  });

  // Coarse heuristic per the plan: any non-zero exit is `session_failed`.
  // Covers both boot-time death (ENOENT, not logged in) and mid-session
  // crashes; the Console reducer is last-writer-wins so post-connect
  // failures still flip the pill to failed correctly. Awaiting here (not
  // void) ensures process.exit() does not cut off the in-flight retry.
  if (exitCode !== 0) {
    const reason = failedReason ?? `claude exited with code ${exitCode}`;
    await postLifecycleEvent({
      workerUrl,
      token,
      threadId,
      event: { kind: 'session_failed', reason },
    });
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  // Async cleanup (redundant with exit handler but safer on normal exit)
  await unlink(mcpConfigPath).catch(() => {});

  process.exit(exitCode);
}
