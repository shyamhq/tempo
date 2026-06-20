import type { Event, VmState } from '@tempo/contracts';
import { shouldWake } from '@tempo/contracts';
import type { TurnHydration } from '@tempo/contracts/http';
import { db } from '@tempo/db/client';
import { events, threads, vm_runs } from '@tempo/db/schema';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { listCommentsForThread } from './comments';
import { listMessagesForThread } from './discussion';
import { getPlanBlocks } from './plan';
import { publishVmSignal } from './redis';

// A VM is "live" only while its heartbeat is fresh. The window is ~2× the E2B
// sandbox idle timeout (10 min in the supervisor), not 1×: a live VM's
// heartbeat can lag during a long single tool call, so a 1× window would reap a
// VM that is genuinely working. 2× absorbs that lag while still closing a true
// corpse within one idle window of slack.
export const HOSTED_HEARTBEAT_STALE_MS = 20 * 60 * 1000;

// Hosted Agent runtime helpers — used by the Worker's wake/drain routes and
// the Console state endpoint. Per-Thread `agent_type` decides the runtime;
// no workspace-level gate. Hosted Threads auto-spawn a Sandbox when a
// wake-eligible event lands (event-log.ts post-hook fires the wake), and the
// "Run Hosted Agent" button is the manual fallback for dead VMs.

// SQL freshness floor: a row is live only if its heartbeat (last_seen_at), or
// its started_at when no heartbeat has landed yet, is newer than this. Computed
// from the JS constant so the boundary is defined in exactly one place.
const freshnessFloor = sql`now() - (${HOSTED_HEARTBEAT_STALE_MS}::double precision / 1000) * interval '1 second'`;

// Predicate for "this open row's heartbeat is still fresh." A null last_seen_at
// (first heartbeat not yet written) falls back to started_at so a just-spawned
// VM isn't treated as dead before its first touch.
const heartbeatFresh = sql`coalesce(${vm_runs.last_seen_at}, ${vm_runs.started_at}) >= ${freshnessFloor}`;
// Exact negation — defined as `NOT (fresh)` so the two predicates can never drift.
const heartbeatStale = sql`NOT (${heartbeatFresh})`;

// Hosted state snapshot for the Console checklist: the live VM with its derived
// provisioning phase, or null when no Sandbox is live. "Live" requires an open
// row (ended_at IS NULL) AND a fresh heartbeat — a phantom open row whose
// heartbeat has lapsed reports null, so it never shows a ghost VM or blocks a
// wake (the spawn path reaps it). The phase is DERIVED, not stored: no sandbox
// yet → still booting (`provisioning`); sandbox_id set → `cloning`. "Done" is
// agent presence (the runner connects its SSE before it would report "ready"),
// reported separately as `agent_present`.
export async function getHostedState(threadId: string): Promise<{ vm: VmState | null }> {
  const [row] = await db
    .select({
      sandbox_id: vm_runs.sandbox_id,
      started_at: vm_runs.started_at,
    })
    .from(vm_runs)
    .where(and(eq(vm_runs.thread_id, threadId), isNull(vm_runs.ended_at), heartbeatFresh))
    .orderBy(desc(vm_runs.started_at))
    .limit(1);
  if (!row) return { vm: null };
  return {
    vm: {
      sandbox_id: row.sandbox_id,
      started_at: row.started_at.toISOString(),
      phase: row.sandbox_id ? 'cloning' : 'provisioning',
    },
  };
}

// Mark the current provisioning run failed: close the open row (so a retry can
// spawn past the partial unique index) and push a `failed` frame carrying the
// reason for the Console checklist. The reason is NOT stored as state — failure
// is terminal and momentary; a reload simply clears it (no live Sandbox). The
// caller MUST pass an already-sanitized reason (it reaches the browser).
export async function failVmRun(threadId: string, rawReason: string): Promise<void> {
  // Bound the reason at the trust boundary: it lands in the DB (exit_reason) and
  // renders in a fixed-width Console popover. Callers pass an already-sanitized
  // string (token-bearing clone URLs scrubbed); this only caps length.
  const reason = rawReason.slice(0, 500);
  // One statement: close the open row AND read back what was actually closed, so
  // the pushed frame can't race a concurrent close. Zero rows (already closed) →
  // still push a `failed` frame; it lands on an already-cleared checklist and is
  // a no-op, so a stale sandbox_id/started_at can't matter.
  const [row] = await db
    .update(vm_runs)
    .set({ ended_at: sql`now()`, exit_reason: reason })
    .where(and(eq(vm_runs.thread_id, threadId), isNull(vm_runs.ended_at)))
    .returning({ sandbox_id: vm_runs.sandbox_id, started_at: vm_runs.started_at });
  await publishVmSignal(threadId, {
    sandbox_id: row?.sandbox_id ?? null,
    started_at: (row?.started_at ?? new Date()).toISOString(),
    phase: 'failed',
    reason,
  });
}

// Heartbeat touch: any container with activity on this thread's VM bumps
// last_seen_at on the open row, keeping it inside the freshness window.
export async function touchVmRun(threadId: string): Promise<void> {
  await db
    .update(vm_runs)
    .set({ last_seen_at: sql`now()` })
    .where(and(eq(vm_runs.thread_id, threadId), isNull(vm_runs.ended_at)));
}

// Lazy reap: close an open row whose heartbeat has lapsed. CRITICAL — the WHERE
// clause carries the freshness predicate (ended_at IS NULL AND heartbeat stale),
// never ended_at IS NULL alone: an unconditional close would re-create the
// sibling-killing boot sweep we deleted, killing a live VM on another container.
// Run by the spawn path before its INSERT so the partial unique index can never
// permanently wedge a thread on a corpse row.
export async function reapStaleVmRun(threadId: string): Promise<void> {
  await db
    .update(vm_runs)
    .set({ ended_at: sql`now()`, exit_reason: 'orphaned_stale' })
    .where(and(eq(vm_runs.thread_id, threadId), isNull(vm_runs.ended_at), heartbeatStale));
}

// Close EVERY open vm_runs row for a thread, regardless of heartbeat freshness.
// Used on a repo change: the live VM's clone list is now stale, so it must die
// before a fresh one is provisioned — and the partial unique index would
// otherwise reject the new INSERT. (reapStaleVmRun is the freshness-gated cousin
// that only closes genuinely-orphaned rows, so it can't kill a live sibling.)
export async function endVmRunsForThread(threadId: string, reason: string): Promise<void> {
  await db
    .update(vm_runs)
    .set({ ended_at: sql`now()`, exit_reason: reason })
    .where(and(eq(vm_runs.thread_id, threadId), isNull(vm_runs.ended_at)));
}

// Everything the runner needs to start a Turn without any MCP round-trips.
// Shape is canonical in packages/contracts/src/http.ts (TurnHydration).
// Returns null if the thread no longer exists (deleted mid-spawn).

export async function getTurnHydration(threadId: string): Promise<TurnHydration | null> {
  const [thread] = await db
    .select({
      title: threads.title,
      description: threads.description,
      repos: threads.repos,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) return null;
  const [plan, comments, messages] = await Promise.all([
    getPlanBlocks(threadId),
    listCommentsForThread(threadId),
    listMessagesForThread(threadId),
  ]);
  return {
    thread,
    plan,
    comments: comments.map((c) => ({
      id: c.id,
      plan_quote: c.plan_quote,
      anchor_block_id: c.anchor_block_id,
      author_user_id: c.author_user_id,
      resolved_by_user_id: c.resolved_by_user_id,
      replies: c.replies.map((r) => ({
        id: r.id,
        author_user_id: r.author_user_id,
        text: r.payload.text,
        mentions: r.mentions,
      })),
    })),
    discussion: {
      messages: messages.map((m) => ({
        id: m.id,
        author_user_id: m.author_user_id,
        text: m.text,
        questions: m.questions,
        attachments: m.attachments,
        mentions: m.mentions,
      })),
    },
  };
}

// Runner's outer-loop drain. Returns wake-able events posted since the last
// completed Turn (or all of them if no Turn has ever run). Stateless query —
// no rows to mark consumed. Idempotent across pollers; we rely on the wake
// endpoint to refuse a second concurrent Sandbox per thread.
export async function getEventsSinceLastTurn(threadId: string): Promise<Event[]> {
  const [floor] = await db
    .select({ seq: sql<number>`coalesce(max(${events.seq}), 0)` })
    .from(events)
    .where(
      and(
        eq(events.thread_id, threadId),
        sql`${events.payload_json}->>'kind' = 'agent_turn_ended'`,
      ),
    );
  const since = floor?.seq ?? 0;

  const rows = await db
    .select({ payload: events.payload_json })
    .from(events)
    .where(and(eq(events.thread_id, threadId), gt(events.seq, since)))
    .orderBy(asc(events.seq));

  return rows.map((r) => r.payload as unknown as Event).filter(shouldWake);
}
