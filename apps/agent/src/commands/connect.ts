import {
  type Event,
  shouldWake,
  type ThreadId,
  ThreadId as ThreadIdSchema,
} from '@tempo/contracts';
import {
  type ThreadAccessResponse,
  ThreadAccessResponse as ThreadAccessResponseSchema,
} from '@tempo/contracts/http';
import { AcpSession, type StopReason } from '../acp/session';
import { type Credentials, read, refresh } from '../credentials';
import { env } from '../env';
import { logger } from '../logger';

const REFRESH_BEFORE_EXPIRY_S = 60;
const POLL_WAIT_SECONDS = 25;

// One persistent ACP session per `tempo-agent connect` lifetime. Failures
// counted here are prompt-level (a single Turn errored out), not spawn-level —
// the adapter subprocess is shared across turns.
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

  let token = creds.token;
  let cursor = access.latest_event_id;
  let abortPoll: AbortController | null = null;
  let session: AcpSession | null = null;
  let stopping = false;

  const onSignal = (): void => {
    if (stopping) return;
    stopping = true;
    logger.debug('connect: signal received, shutting down');
    abortPoll?.abort();
    // Cancel may race with the adapter teardown; catch so a broken-pipe
    // write doesn't become an unhandled rejection.
    session?.cancel().catch(() => null);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let consecutiveFailures = 0;
  let exitCode = 0;
  let terminalFailReason: string | null = null;

  const makeSession = (tok: string): AcpSession =>
    new AcpSession({
      threadId,
      cwd: process.cwd(),
      workerUrl: creds.worker_url,
      token: tok,
      adapterCmd: env.TEMPO_AGENT_ADAPTER_CMD,
      adapterArgs: env.TEMPO_AGENT_ADAPTER_ARGS?.split(/\s+/).filter(Boolean),
    });

  try {
    session = makeSession(token);

    try {
      await session.start();
    } catch (err) {
      terminalFailReason = `adapter failed to start: ${errMsg(err)}`.slice(0, 200);
      process.stderr.write(`tempo connect: ${terminalFailReason}\n`);
      exitCode = 1;
      return;
    }

    // Turn 1 — full Thread context.
    const firstPayload = JSON.stringify({
      thread_id: threadId,
      events: [],
      context: access.context,
    });
    const first = await sendPrompt(session, firstPayload);
    if (first === 'failed') consecutiveFailures = 1;

    // Loop until SIGINT or N consecutive failures.
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
      const polled = await pollEvents(threadId, cursor, creds.worker_url, token, abortPoll.signal);
      abortPoll = null;
      if (stopping) break;

      if (polled === 'token-expired') {
        // Refresh, then restart the session — the bearer token is baked into
        // the MCP server config at newSession time and can't be updated mid-session.
        creds = await refresh(creds);
        token = creds.token;
        await session.close();
        session = makeSession(token);
        await session.start();
        continue;
      }
      if (polled === 'aborted') break;

      cursor = polled.cursor;
      // Stop button: Dev pressed Cancel on the Thread → server emits
      // `agent_cancel_requested`. Not a wake kind (we don't restart the Turn),
      // but the live session must abort its in-flight prompt.
      if (polled.events.some((e) => e.kind === 'agent_cancel_requested')) {
        session?.cancel().catch(() => null);
      }
      const events = polled.events.filter(shouldWake);
      if (events.length === 0) continue;

      const nudgePayload = JSON.stringify({ thread_id: threadId, events });
      const result = await sendPrompt(session, nudgePayload);
      if (result === 'failed') {
        consecutiveFailures += 1;
        logger.debug({ consecutiveFailures }, 'connect: nudged turn failed');
        // If the adapter itself died, rebuild before the next iteration.
        // The strike count keeps incrementing — a broken adapter binary loops
        // until it trips MAX_CONSECUTIVE_TURN_FAILURES rather than indefinitely.
        if (!session.isAlive()) {
          logger.info('connect: adapter exited, respawning');
          await session.close();
          try {
            session = makeSession(token);
            await session.start();
          } catch (err) {
            terminalFailReason = `adapter respawn failed: ${errMsg(err)}`.slice(0, 200);
            process.stderr.write(`tempo connect: ${terminalFailReason}\n`);
            exitCode = 1;
            break;
          }
        }
      } else {
        consecutiveFailures = 0;
      }
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (terminalFailReason) {
      process.stderr.write(`tempo connect: ${terminalFailReason}\n`);
    }
    await postAgentDisconnected(threadId, creds.worker_url, token);
    await session?.close();
  }

  process.exit(exitCode);
}

// Best-effort goodbye on clean shutdown. Worker handler nulls
// `threads.agent_last_seen_at` and emits `agent_disconnected` so the Console
// flips presence to idle without waiting for the 60s window. Hard kills don't
// reach this path; they age out via the column window.
async function postAgentDisconnected(
  threadId: ThreadId,
  workerUrl: string,
  token: string,
): Promise<void> {
  try {
    await fetch(`${workerUrl}/api/agent-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ thread_id: threadId, event: { kind: 'agent_disconnected' } }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (err) {
    logger.debug({ err }, 'connect: agent_disconnected post failed (continuing exit)');
  }
}

type PromptOutcome = 'ok' | 'failed';

async function sendPrompt(session: AcpSession, payload: string): Promise<PromptOutcome> {
  try {
    const stop: StopReason = await session.prompt(payload);
    if (stop === 'end_turn' || stop === 'cancelled') return 'ok';
    logger.debug({ stop }, 'connect: turn ended with non-clean stop reason');
    return 'failed';
  } catch (err) {
    logger.warn({ err: errMsg(err) }, 'connect: prompt threw');
    return 'failed';
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readCreds(): Promise<Credentials> {
  return read().catch((err) => {
    process.stderr.write(`${errMsg(err)}\n`);
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
      `tempo connect failed: could not refresh token — ${errMsg(err)}\n` +
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
    process.stderr.write(`tempo connect failed: could not reach Worker (${errMsg(err)})\n`);
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

type PollResult = { events: Event[]; cursor: string } | 'token-expired' | 'aborted';

async function pollEvents(
  threadId: string,
  cursor: string,
  workerUrl: string,
  token: string,
  signal: AbortSignal,
): Promise<PollResult> {
  const url =
    `${workerUrl}/api/threads/${threadId}/events` +
    `?cursor=${encodeURIComponent(cursor)}&wait=${POLL_WAIT_SECONDS}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
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
