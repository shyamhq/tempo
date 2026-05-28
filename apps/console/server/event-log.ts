import type { Event } from '@tempo/contracts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db';
import { newEventId } from '../db/ids';
import { events } from '../db/schema';

// Per-thread monotonic counter source: COUNT(*) of existing event rows for the
// thread at append time, inside a transaction. SQLite is single-writer so the
// count + insert pair under one transaction yields a strictly monotonic
// sequence per thread without a separate counter table. The lexicographic
// 14-digit zero-pad in newEventId keeps cursor comparisons correct.

type AppendPayload = Event extends infer E
  ? E extends { id: string; created_at: string }
    ? Omit<E, 'id' | 'created_at'>
    : never
  : never;

export async function appendEvent(threadId: string, payload: AppendPayload): Promise<Event> {
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(events)
      .where(eq(events.thread_id, threadId));
    const n = rows[0]?.n ?? 0;
    const id = newEventId(n + 1);
    const created_at = new Date().toISOString();
    const event = { id, created_at, ...payload } as Event;
    await tx.insert(events).values({
      id,
      thread_id: threadId,
      kind: event.kind,
      payload_json: event as unknown as Record<string, unknown>,
      created_at,
    });
    return event;
  });
}

export async function readEventsAfter(threadId: string, cursor: string): Promise<Event[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.thread_id, threadId), gt(events.id, cursor)))
    .orderBy(asc(events.id));
  return rows.map((r) => r.payload_json as unknown as Event);
}

export async function latestEventId(threadId: string): Promise<string> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.thread_id, threadId))
    .orderBy(sql`${events.id} DESC`)
    .limit(1);
  return rows[0]?.id ?? newEventId(0);
}
