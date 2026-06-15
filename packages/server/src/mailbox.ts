import { type Event, shouldWake } from '@tempo/contracts';
import { db, pool } from '@tempo/db/client';
import { events, mailbox_events, threads, workspaces } from '@tempo/db/schema';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { newMailboxEventId } from './ids';

// Writes one mailbox_events row for a Hosted-enabled Thread; emits
// pg_notify('mailbox', threadId) for live wake-up. Idempotent: repeated
// calls for the same (thread_id, event_id) no-op via ON CONFLICT.
//
// Does NOT check presence — that's the caller's job. Worker wraps this
// with an isFresh early-return; Console calls it directly (no in-process
// presence Map) and over-enqueues. The supervisor (Task 2.7) does the
// final isFresh check before spending money on a VM.
export async function enqueueMailboxIfHosted(threadId: string, event: Event): Promise<void> {
  if (!shouldWake(event)) return;
  const ws = await db
    .select({ enabled: workspaces.hosted_enabled })
    .from(workspaces)
    .innerJoin(threads, eq(threads.workspace_id, workspaces.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!ws[0]?.enabled) return;

  await db
    .insert(mailbox_events)
    .values({ id: newMailboxEventId(), thread_id: threadId, event_id: event.id })
    .onConflictDoNothing();
  await db.execute(sql`SELECT pg_notify('mailbox', ${threadId})`);
}

// Atomic claim: UPDATE ... RETURNING marks the rows consumed and yields
// their event_ids in one round-trip. One reader per threadId (the VM
// bound to that Thread) means no contention; SKIP LOCKED is unnecessary.
export async function drainPending(threadId: string): Promise<Event[]> {
  const claimed = await db
    .update(mailbox_events)
    .set({ consumed_at: sql`now()` })
    .where(and(eq(mailbox_events.thread_id, threadId), isNull(mailbox_events.consumed_at)))
    .returning({ event_id: mailbox_events.event_id });

  if (claimed.length === 0) return [];

  const rows = await db
    .select({ payload: events.payload_json })
    .from(events)
    .where(
      and(
        eq(events.thread_id, threadId),
        inArray(
          events.id,
          claimed.map((r) => r.event_id),
        ),
      ),
    )
    .orderBy(asc(events.seq));
  return rows.map((r) => r.payload as unknown as Event);
}

export type WakeListener = { close: () => Promise<void> };

// One LISTEN per Worker process — checks out a single pool connection
// permanently. node-postgres' Pool does NOT idle-timeout checked-out
// clients, so the subscription stays live across the process lifetime.
// Pool default size is 10; reserving one slot for LISTEN is fine at MVP
// scale. If you ever see "out of connections", this is the suspect.
export async function subscribeWakeups(opts: {
  onWake: (threadId: string) => void;
}): Promise<WakeListener> {
  const client = await pool.connect();
  client.on('notification', (msg) => {
    if (msg.channel === 'mailbox' && msg.payload) opts.onWake(msg.payload);
  });
  // ponytail: promote to structured logger when @tempo/server adopts one.
  client.on('error', (err) => {
    console.error('mailbox LISTEN connection error', { err });
  });
  await client.query('LISTEN mailbox');
  return {
    close: async () => {
      // UNLISTEN on a dying socket can throw; we're closing anyway.
      try {
        await client.query('UNLISTEN mailbox');
      } catch {}
      client.release();
    },
  };
}
