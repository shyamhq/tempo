import { type Event, type ThreadId, ThreadId as ThreadIdSchema } from '@tempo/contracts';
import {
  type ThreadAccessResponse,
  ThreadAccessResponse as ThreadAccessResponseSchema,
} from '@tempo/contracts/http';
import { AcpSession, type StopReason } from '../acp/session';
import { type Credentials, read, refresh } from '../credentials';
import { env } from '../env';
import { runWakeSubscriber } from '../events/subscriber';
import { logger } from '../logger';

const REFRESH_BEFORE_EXPIRY_S = 60;
// Bump presence well inside the Console's 60s `agent_last_seen_at` window.
const HEARTBEAT_INTERVAL_MS = 20_000;

// One persistent ACP session per `tempo-agent connect` lifetime. Failures
// counted here are prompt-level (a single Turn errored out), not spawn-level —
// the adapter subprocess is shared across turns.
const MAX_CONSECUTIVE_TURN_FAILURES = 3;
// Auth failures that survive a token refresh (the Worker keeps rejecting the
// new token) — bail rather than hammer the refresh endpoint forever.
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;

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
  let session: AcpSession | null = null;
  let stopping = false;

  // Wake buffer + turn state. The SSE subscriber pushes human-authored events
  // here. A wake arriving mid-turn cancels the turn so the loop re-prompts with
  // it; arriving between turns it wakes the idle loop.
  const pending: Event[] = [];
  let turnInFlight = false;
  let needsRefresh = false;
  let wakeNotify: (() => void) | null = null;
  const notify = (): void => {
    const resolve = wakeNotify;
    wakeNotify = null;
    resolve?.();
  };

  const subAbort = new AbortController();

  const onSignal = (): void => {
    if (stopping) return;
    stopping = true;
    logger.debug('connect: signal received, shutting down');
    subAbort.abort();
    // Cancel may race with the adapter teardown; catch so a broken-pipe write
    // doesn't become an unhandled rejection.
    session?.cancel().catch(() => null);
    notify();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let consecutiveFailures = 0;
  let consecutiveAuthFailures = 0;
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

  // Tail the Worker SSE feed for wake events. Runs until subAbort fires.
  const subscriber = runWakeSubscriber({
    threadId,
    workerUrl: creds.worker_url,
    getToken: () => token,
    signal: subAbort.signal,
    onWake: (event) => {
      pending.push(event);
      if (turnInFlight) session?.cancel().catch(() => null);
      else notify();
    },
    onCancel: () => {
      // Dev pressed Stop — abort the in-flight turn, don't re-prompt.
      if (turnInFlight) session?.cancel().catch(() => null);
    },
    onAuthError: () => {
      needsRefresh = true;
      notify();
    },
    onConnected: () => {
      consecutiveAuthFailures = 0;
    },
  });

  // Keep Console presence fresh while idle. During turns, MCP + gateway calls
  // already bump `agent_last_seen_at`; this covers the gap between turns now
  // that the CLI tails SSE instead of re-hitting an endpoint each cycle.
  const heartbeat = setInterval(() => {
    void postHeartbeat(threadId, creds.worker_url, token).then((authOk) => {
      if (!authOk) {
        needsRefresh = true;
        notify();
      }
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    session = makeSession(token);

    try {
      await session.start();
    } catch (err) {
      terminalFailReason = `adapter failed to start: ${errMsg(err)}`.slice(0, 200);
      exitCode = 1;
      return;
    }

    // Turn 1 — full Thread context. Cancellable: a Dev comment while the agent
    // is still exploring should interrupt and fold in.
    const firstPayload = JSON.stringify({
      thread_id: threadId,
      events: [],
      context: access.context,
    });
    turnInFlight = true;
    let first: PromptOutcome;
    try {
      first = await sendPrompt(session, firstPayload);
    } finally {
      turnInFlight = false;
    }
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

      // Token upkeep, between turns only — refresh and restart the session so
      // the new bearer is re-baked into the MCP server config (it can't change
      // mid-session). refresh() uses the refresh token, so it works even after
      // the access token has expired.
      if (needsRefresh || nearExpiry(creds)) {
        const dueToAuthError = needsRefresh;
        try {
          creds = await refresh(creds);
          token = creds.token;
          needsRefresh = false;
          await session.close();
          session = makeSession(token);
          await session.start();
        } catch (err) {
          terminalFailReason = `token refresh / session restart failed: ${errMsg(err)}`.slice(
            0,
            200,
          );
          exitCode = 1;
          break;
        }
        // A 401-triggered refresh the Worker still rejects means re-auth is
        // needed. onConnected resets this the moment a stream reopens cleanly,
        // so only a persistent failure trips the limit.
        if (dueToAuthError) {
          consecutiveAuthFailures += 1;
          if (consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
            terminalFailReason =
              'authentication kept failing after refresh — run `tempo-agent init` to re-authenticate';
            exitCode = 1;
            break;
          }
        }
      }

      // Wait for buffered wake events. A notify() also fires for stop/refresh.
      if (pending.length === 0) {
        await new Promise<void>((resolve) => {
          // Re-check inside the executor: an onWake between the length check and
          // here would otherwise be missed (defensive — JS is single-threaded,
          // so today nothing can interleave, but this keeps it honest).
          if (stopping || pending.length > 0 || needsRefresh) {
            resolve();
            return;
          }
          wakeNotify = resolve;
        });
        if (stopping) break;
        continue;
      }

      const events = pending.splice(0);
      turnInFlight = true;
      let result: PromptOutcome;
      try {
        result = await sendPrompt(session, JSON.stringify({ thread_id: threadId, events }));
      } finally {
        turnInFlight = false;
      }

      if (result === 'failed') {
        consecutiveFailures += 1;
        logger.debug({ consecutiveFailures }, 'connect: nudged turn failed');
        // If the adapter itself died, rebuild before the next iteration. The
        // strike count keeps incrementing — a broken adapter binary trips
        // MAX_CONSECUTIVE_TURN_FAILURES rather than looping forever.
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
    clearInterval(heartbeat);
    subAbort.abort();
    if (terminalFailReason) {
      process.stderr.write(`tempo connect: ${terminalFailReason}\n`);
    }
    await postAgentDisconnected(threadId, creds.worker_url, token);
    await session?.close();
    await subscriber.catch(() => null);
  }

  process.exit(exitCode);
}

// Best-effort presence ping. Returns false only on a 401 (token expired) so the
// caller can refresh; transient network errors return true (don't churn the
// session over a blip).
async function postHeartbeat(threadId: string, workerUrl: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${workerUrl}/api/threads/${threadId}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.status !== 401;
  } catch (err) {
    logger.debug({ err }, 'connect: heartbeat failed (continuing)');
    return true;
  }
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

function nearExpiry(creds: Credentials): boolean {
  return new Date(creds.expires_at).getTime() - Date.now() < REFRESH_BEFORE_EXPIRY_S * 1000;
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
  if (!nearExpiry(creds)) return creds;
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
