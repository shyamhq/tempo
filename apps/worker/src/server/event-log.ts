import { db } from '@tempo/db/client';
import { newEventId } from '@tempo/db/ids';
import { events } from '@tempo/db/schema';
import { sql } from 'drizzle-orm';

// Single-statement event-log append. nextval allocates the sequence value up
// front so the id (`evt_<padded-seq>`) can be derived and inserted with seq
// together in one INSERT. Mirrors Console's appendEvent pattern in
// apps/console/server/event-log.ts; full module move happens in slice 1c-2.
//
// The pg bigint comes back as a string, which newEventId padStarts without
// precision loss at sequence values above Number.MAX_SAFE_INTEGER.
export async function appendEvent(
  threadId: string,
  payload: { kind: string } & Record<string, unknown>,
): Promise<{ id: string; seq: number }> {
  const seqResult = await db.execute(
    sql`SELECT nextval(pg_get_serial_sequence('events', 'seq')) AS n`,
  );
  const row = seqResult.rows[0];
  if (!row) throw new Error('nextval returned no row');
  const seqStr = String(row.n);
  const id = newEventId(seqStr);
  const seq = Number(seqStr);
  const created_at_date = new Date();
  // payload_json carries the full Event-shaped object (id + created_at + the
  // kind-specific fields) so Console's UI parses it as a complete Event from
  // packages/contracts/src/events.ts without needing the row's other columns.
  const event = { id, created_at: created_at_date.toISOString(), ...payload };
  await db.insert(events).values({
    id,
    seq,
    thread_id: threadId,
    kind: payload.kind,
    payload_json: event as Record<string, unknown>,
    created_at: created_at_date,
  });
  return { id, seq };
}
