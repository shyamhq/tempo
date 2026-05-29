import { readFile, writeFile } from 'node:fs/promises';
import { ConnectToken, EventId, ThreadId, ZERO_EVENT_CURSOR } from '@tempo/contracts';
import { z } from 'zod';
import { env } from './env';
import { ConsoleClient } from './http-client';

// Stop hook entry point.
//
// Claude Code fires this when the Agent decides its turn is done. We long-poll
// the Console for new events: if any arrived, we block the stop and inject an
// `additionalContext` nudge so the Agent calls `tempo_poll` and acts on them
// on its next turn. If the long-poll times out empty, we exit 0 silently and
// the Agent really does stop (the ScheduleWakeup heartbeat in the initial
// prompt catches comments that arrive past this window).
//
// stdout = hook JSON response (read by Claude Code). All logs to stderr.

const POLL_WAIT_SECONDS = 25;

const StopHookEnv = z.object({
  TEMPO_CONNECT_TOKEN: ConnectToken,
  TEMPO_THREAD_ID: ThreadId,
  TEMPO_CURSOR_FILE: z.string().min(1),
});

export async function runStopHook(): Promise<void> {
  const parsed = StopHookEnv.safeParse(process.env);
  if (!parsed.success) {
    // Missing env means we're not in a tempo-driven session; silently allow
    // the stop. Non-zero would block the parent Agent for no reason.
    return;
  }
  const { TEMPO_CONNECT_TOKEN, TEMPO_THREAD_ID, TEMPO_CURSOR_FILE } = parsed.data;

  // Drain stdin so Claude Code doesn't see a broken pipe; we don't use the
  // payload but the hook contract expects us to consume it.
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  const cursor = await loadCursor(TEMPO_CURSOR_FILE);
  const client = new ConsoleClient(env.TEMPO_CONSOLE_URL, TEMPO_CONNECT_TOKEN);

  let result: Awaited<ReturnType<ConsoleClient['poll']>>;
  try {
    result = await client.poll(TEMPO_THREAD_ID, cursor, POLL_WAIT_SECONDS);
  } catch {
    // Network/HTTP error — allow the stop. Better to let the Agent idle than
    // to deadlock it on a transient failure.
    return;
  }

  if (result.events.length === 0) return;

  await writeFile(TEMPO_CURSOR_FILE, result.cursor, 'utf8');

  const kinds = new Map<string, number>();
  for (const e of result.events) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const kindSummary = Array.from(kinds.entries())
    .map(([k, n]) => (n > 1 ? `${n}× ${k}` : k))
    .join(', ');

  // Stop hook output schema only accepts top-level fields (no
  // hookSpecificOutput). `reason` is shown back to Claude on the blocked
  // continuation, so we carry the full nudge there.
  const response = {
    decision: 'block',
    reason:
      `New Console events arrived (${result.events.length}): ${kindSummary}. ` +
      `Call tempo_poll now with the cursor from your most recent tempo_attach ` +
      `or tempo_poll response (not this notification) to fetch full payloads, ` +
      `then act on each (tempo_post_reply for new Comments, tempo_pull_plan ` +
      `if plan_edited_by_dev appears, etc.).`,
  };
  process.stdout.write(JSON.stringify(response));
}

async function loadCursor(path: string): Promise<EventId> {
  try {
    const raw = (await readFile(path, 'utf8')).trim();
    const parsed = EventId.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {
    // missing or unreadable — fall through to sentinel
  }
  return ZERO_EVENT_CURSOR;
}
