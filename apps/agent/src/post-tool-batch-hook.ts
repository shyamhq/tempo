import { readFile, writeFile } from 'node:fs/promises';
import { ConnectToken, type Event, EventId, ThreadId, ZERO_EVENT_CURSOR } from '@tempo/contracts';
import { z } from 'zod';
import { env } from './env';
import { ConsoleClient } from './http-client';

// PostToolBatch hook entry point. Gated by TEMPO_MIDTURN_HOOK in spawn-claude.
//
// Fires once per batch of parallel tool calls, before the next model call. We
// poll the Console with wait=0 (return-immediately); on a non-empty result we
// emit `additionalContext` so the Agent folds new Comments into the same turn.
// Empty result, network error, or missing env => silent no-op; the Stop hook
// remains the safety net for everything we drop here.
//
// Shares TEMPO_CURSOR_FILE with the Stop hook: both writers answer the same
// question ("what has the Agent already been told about?") and only advance
// monotonically, so a torn write at worst re-injects on the next fire.
//
// stdout = hook JSON response (read by Claude Code). All logs to stderr.

const POLL_WAIT_SECONDS = 0;
// Token-budget caps for the inline preview. Beyond MAX_EVENTS_INLINE we
// summarise so the additionalContext stays small and the Agent is nudged to
// call tempo_poll for full payloads.
const MAX_EVENTS_INLINE = 3;
const MAX_CHARS_PER_EVENT = 500;

const BatchHookEnv = z.object({
  TEMPO_CONNECT_TOKEN: ConnectToken,
  TEMPO_THREAD_ID: ThreadId,
  TEMPO_CURSOR_FILE: z.string().min(1),
});

export async function runPostToolBatchHook(): Promise<void> {
  const parsed = BatchHookEnv.safeParse(process.env);
  if (!parsed.success) return;
  const { TEMPO_CONNECT_TOKEN, TEMPO_THREAD_ID, TEMPO_CURSOR_FILE } = parsed.data;

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
    return;
  }

  if (result.events.length === 0) return;

  await writeFile(TEMPO_CURSOR_FILE, result.cursor, 'utf8');

  const response = {
    hookSpecificOutput: {
      hookEventName: 'PostToolBatch',
      additionalContext: formatNudge(result.events),
    },
  };
  process.stdout.write(JSON.stringify(response));
}

function formatNudge(events: Event[]): string {
  const kinds = new Map<string, number>();
  for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const kindSummary = Array.from(kinds.entries())
    .map(([k, n]) => (n > 1 ? `${n}× ${k}` : k))
    .join(', ');

  const inline = events
    .slice(0, MAX_EVENTS_INLINE)
    .map((e) => {
      const s = JSON.stringify(e);
      return s.length <= MAX_CHARS_PER_EVENT ? s : `${s.slice(0, MAX_CHARS_PER_EVENT - 1)}…`;
    })
    .join('\n');

  const tail =
    events.length > MAX_EVENTS_INLINE
      ? `\n…${events.length - MAX_EVENTS_INLINE} more event(s) queued — call tempo_poll for full payloads.`
      : '';

  return (
    `New Console events arrived mid-turn (${events.length}): ${kindSummary}.\n` +
    `${inline}${tail}\n` +
    `Call tempo_poll with the cursor from your most recent tempo_attach or ` +
    `tempo_poll response (not this notification) to fetch full payloads, then ` +
    `act on each (tempo_post_reply for new Comments, tempo_pull_plan if ` +
    `plan_edited_by_dev appears, etc.).`
  );
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
