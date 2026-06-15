import { type Event, shouldWake } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import { mailbox_events, threads, workspaces } from '@tempo/db/schema';
import { eq, sql } from 'drizzle-orm';
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
