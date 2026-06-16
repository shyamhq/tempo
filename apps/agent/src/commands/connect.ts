import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Event,
  type ThreadId,
  ThreadId as ThreadIdSchema,
  shouldWake,
} from '@tempo/contracts';
import {
  type ThreadAccessResponse,
  ThreadAccessResponse as ThreadAccessResponseSchema,
} from '@tempo/contracts/http';
import { type Credentials, read, refresh } from '../credentials';
import { postLifecycleEvent } from '../lifecycle';
import { logger } from '../logger';
import { runTurn } from '../turn';

const REFRESH_BEFORE_EXPIRY_S = 60;
const POLL_WAIT_SECONDS = 25;

// Spawn-time failures (binary missing, login required) exit immediately;
// `nonzero-exit` (Claude ran but failed) increments this counter. Reset
// to zero on every clean exit so a brief Worker hiccup doesn't accumulate
// indefinitely toward the kill switch.
const MAX_CONSECUTIVE_TURN_FAILURES = 3;

export async function connectCommand(rawThreadId: string | undefined): Promise<void> {
  if (!rawThreadId) {
    process.stderr.write('usage: tempo-agent connect <thread-id>\n');
    process.exit(2);
  }
  const parsed = ThreadIdSchema.safeParse(rawThreadId);
  if (!parsed.success) {
    process.stderr.write(`tempo connect: "${rawThreadId}" is not a valid thread id\n`);
    process.exit(2);
  }
  const threadId = parsed.data;

  let creds = await readCreds();
  creds = await maybeRefresh(creds);

  const access = await preflight(threadId, creds);
  process.stdout.write(
    `Connecting to ${access.workspace_name}'s Thread "${access.thread_title}"...\n`,
  );

  // Surface boot progress in Console before tempo_attach lands. The
  // Console reducer flips session_status to 'initiating' until
  // session_connected (from tempo_attach) overrides, or session_failed
  // lands on terminal exit.
  await postLifecycleEvent({
    workerUrl: creds.worker_url,
    token: creds.token,
    threadId,
    event: { kind: 'session_initiating' },
  });

  const mcpConfigPath = await writeMcpConfig(creds, threadId);
  registerExitCleanup(mcpConfigPath);

  let token = creds.token;
  // Stable presence id for this CLI session — sent as X-Tempo-Conn-Id on every poll.
  const connId = randomBytes(8).toString('hex');
  let cursor = access.latest_event_id;
  let abortPoll: AbortController | null = null;
  let activeKill: (() => void) | null = null;
  let stopping = false;
  const onSignal = (): void => {
    if (stopping) return;
    stopping = true;
    logger.debug('connect: signal received, shutting down');
    abortPoll?.abort();
    activeKill?.();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let claudeSessionId: string | null = null;
  let consecutiveFailures = 0;
  let exitCode = 0;
  let terminalFailReason: string | null = null;

  try {
    // Turn 1 — attach (no --resume).
    const first = await runTurn(
      {
        kind: 'attach',
        threadId,
        mcpConfigPath,
        workerUrl: creds.worker_url,
        token,
        context: access.context,
      },
      (kill) => {
        activeKill = kill;
      },
    );
    activeKill = null;

    if (first.outcome === 'spawn-error') {
      terminalFailReason = `claude failed to spawn: ${first.message}`.slice(0, 200);
      process.stderr.write(
        `tempo connect: failed to spawn claude — ${first.message}\n` +
          'Make sure claude is installed: https://docs.anthropic.com/en/docs/claude-code\n',
      );
      exitCode = 1;
    } else {
      claudeSessionId = first.claudeSessionId;
      if (first.outcome === 'nonzero-exit') consecutiveFailures = 1;

      // Loop until SIGINT or N consecutive failures. Each nudged Turn
      // resumes the same claude conversation; queued events drain
      // immediately when the previous Turn exits.
      while (!stopping) {
        if (consecutiveFailures >= MAX_CONSECUTIVE_TURN_FAILURES) {
          terminalFailReason = `${MAX_CONSECUTIVE_TURN_FAILURES} consecutive Turns failed`;
          process.stderr.write(
            `tempo connect: ${MAX_CONSECUTIVE_TURN_FAILURES} consecutive Turns failed; exiting. ` +
              'Re-run `tempo-agent connect` once the underlying issue is resolved.\n',
          );
          exitCode = 1;
          break;
        }

        abortPoll = new AbortController();
        const polled = await pollEvents(
          threadId,
          cursor,
          creds.worker_url,
          token,
          connId,
          abortPoll.signal,
        );
        abortPoll = null;
        if (stopping) break;

        if (polled === 'token-expired') {
          creds = await refresh(creds);
          token = creds.token;
          await rewriteMcpConfig(mcpConfigPath, creds, threadId);
          continue;
        }
        if (polled === 'aborted') break;

        cursor = polled.cursor;
        const events = polled.events.filter(shouldWake);
        if (events.length === 0) continue;

        const result = claudeSessionId
          ? await runTurn(
              {
                kind: 'resume',
                threadId,
                mcpConfigPath,
                workerUrl: creds.worker_url,
                token,
                claudeSessionId,
                events,
              },
              (kill) => {
                activeKill = kill;
              },
            )
          : // Lost the session_id (Turn 1 didn't emit one, or `--resume`
            // failed). Fall back to a fresh attach with the original context
            // snapshot — may be slightly stale but avoids a second /access call.
            await runTurn(
              {
                kind: 'attach',
                threadId,
                mcpConfigPath,
                workerUrl: creds.worker_url,
                token,
                context: access.context,
              },
              (kill) => {
                activeKill = kill;
              },
            );
        activeKill = null;

        if (result.outcome === 'spawn-error') {
          terminalFailReason = `claude failed to spawn: ${result.message}`.slice(0, 200);
          process.stderr.write(`tempo connect: claude spawn failed — ${result.message}\n`);
          exitCode = 1;
          break;
        }
        if (result.claudeSessionId) claudeSessionId = result.claudeSessionId;
        if (result.outcome === 'clean') {
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          logger.debug(
            { consecutiveFailures, exitCode: result.exitCode },
            'connect: nudged turn failed',
          );
        }
      }
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (terminalFailReason) {
      await postLifecycleEvent({
        workerUrl: creds.worker_url,
        token,
        threadId,
        event: { kind: 'session_failed', reason: terminalFailReason },
      });
    }
    await unlink(mcpConfigPath).catch(() => {});
  }

  process.exit(exitCode);
}

async function readCreds(): Promise<Credentials> {
  return read().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

async function maybeRefresh(creds: Credentials): Promise<Credentials> {
  const expiresAt = new Date(creds.expires_at).getTime();
  if (expiresAt - Date.now() >= REFRESH_BEFORE_EXPIRY_S * 1000) return creds;
  logger.debug({ expires_at: creds.expires_at }, 'token near expiry, refreshing');
  try {
    return await refresh(creds);
  } catch (err) {
    process.stderr.write(
      `tempo connect failed: could not refresh token — ${err instanceof Error ? err.message : String(err)}\n` +
        'Run `tempo-agent init` to re-authenticate.\n',
    );
    process.exit(1);
  }
}

async function preflight(threadId: ThreadId, creds: Credentials): Promise<ThreadAccessResponse> {
  let res: Response;
  try {
    res = await fetch(`${creds.worker_url}/api/threads/${threadId}/access`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
  } catch (err) {
    process.stderr.write(
      `tempo connect failed: could not reach Worker (${err instanceof Error ? err.message : String(err)})\n`,
    );
    process.exit(1);
  }
  if (res.status === 404) {
    process.stderr.write(`tempo connect failed: thread "${threadId}" not found\n`);
    process.exit(1);
  }
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = body.error === 'not_a_member' ? 'not a member of this workspace' : 'forbidden';
    process.stderr.write(`tempo connect failed: ${reason}\n`);
    process.exit(1);
  }
  if (!res.ok) {
    process.stderr.write(`tempo connect failed: unexpected error (HTTP ${res.status})\n`);
    process.exit(1);
  }
  const parsed = ThreadAccessResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    process.stderr.write(
      'tempo connect failed: Worker /access response did not match contract — ' +
        'is the Worker on a compatible version?\n',
    );
    process.exit(1);
  }
  return parsed.data;
}

async function writeMcpConfig(creds: Credentials, threadId: string): Promise<string> {
  const suffix = randomBytes(4).toString('hex');
  const path = join(tmpdir(), `tempo-${process.pid}-${suffix}.json`);
  await rewriteMcpConfig(path, creds, threadId);
  return path;
}

async function rewriteMcpConfig(path: string, creds: Credentials, threadId: string): Promise<void> {
  const mcpConfig = {
    mcpServers: {
      tempo: {
        type: 'http',
        url: `${creds.worker_url}/mcp`,
        headers: { Authorization: `Bearer ${creds.token}`, 'X-Tempo-Thread-Id': threadId },
      },
    },
  };
  await writeFile(path, JSON.stringify(mcpConfig, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

type PollResult = { events: Event[]; cursor: string } | 'token-expired' | 'aborted';

async function pollEvents(
  threadId: string,
  cursor: string,
  workerUrl: string,
  token: string,
  connId: string,
  signal: AbortSignal,
): Promise<PollResult> {
  const url =
    `${workerUrl}/api/threads/${threadId}/events` +
    `?cursor=${encodeURIComponent(cursor)}&wait=${POLL_WAIT_SECONDS}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-Tempo-Conn-Id': connId },
      signal,
    });
  } catch (err) {
    if (signal.aborted) return 'aborted';
    logger.debug({ err }, 'poll: fetch error, will retry');
    return { events: [], cursor };
  }
  if (res.status === 401) return 'token-expired';
  if (!res.ok) {
    logger.debug({ status: res.status }, 'poll: unexpected status, will retry');
    return { events: [], cursor };
  }
  const json = (await res.json()) as { events: Event[]; cursor: string };
  return json;
}

function registerExitCleanup(path: string): void {
  process.once('exit', () => {
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  });
}
