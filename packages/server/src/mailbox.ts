import type { Event } from '@tempo/contracts';
import { shouldWake } from '@tempo/contracts';
import type { TurnHydration } from '@tempo/contracts/http';
import { db } from '@tempo/db/client';
import { events, threads, vm_runs } from '@tempo/db/schema';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { listCommentsForThread } from './comments';
import { listMessagesForThread } from './discussion';
import { getPlanBlocks } from './plan';

// Hosted Agent runtime helpers — used by the Worker's wake/drain routes and
// the Console state endpoint. Per-Thread `agent_type` decides the runtime;
// no workspace-level gate. Hosted Threads auto-spawn a Sandbox when a
// wake-eligible event lands (event-log.ts post-hook fires the wake), and the
// "Run Hosted Agent" button is the manual fallback for dead VMs.

// Hosted state snapshot for the Console card: live VM metadata, or null if
// no Sandbox is currently provisioned.
// ponytail: vm.ended_at is wallclock-updated by the supervisor; a Worker
// crash leaves the row open. Add a heartbeat / TTL column when the gap bites.
export async function getHostedState(
  threadId: string,
): Promise<{ vm: { sandbox_id: string; started_at: string } | null }> {
  const [row] = await db
    .select({
      sandbox_id: vm_runs.sandbox_id,
      started_at: vm_runs.started_at,
    })
    .from(vm_runs)
    .where(and(eq(vm_runs.thread_id, threadId), isNull(vm_runs.ended_at)))
    .orderBy(desc(vm_runs.started_at))
    .limit(1);
  if (!row?.sandbox_id) return { vm: null };
  return { vm: { sandbox_id: row.sandbox_id, started_at: row.started_at.toISOString() } };
}

// True when a Sandbox is already alive for this thread — the wake endpoint
// and the event-log post-hook both use this to skip a redundant spawn.
export async function isHostedReadyToWake(threadId: string): Promise<{ live: boolean }> {
  const state = await getHostedState(threadId);
  return { live: state.vm !== null };
}

// Everything the runner needs to start a Turn without any MCP round-trips.
// Shape is canonical in packages/contracts/src/http.ts (TurnHydration).
// Returns null if the thread no longer exists (deleted mid-spawn).

export async function getTurnHydration(threadId: string): Promise<TurnHydration | null> {
  const [thread] = await db
    .select({
      title: threads.title,
      description: threads.description,
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
      resolved_by: c.resolved_by,
      replies: c.replies.map((r) => ({ id: r.id, author: r.author, text: r.payload.text })),
    })),
    discussion: {
      messages: messages.map((m) => ({
        id: m.id,
        author: m.author,
        text: m.text,
        questions: m.questions,
        attachments: m.attachments,
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
