import type { AttachmentRef, Event } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import { newEventId } from '@tempo/db/ids';
import { events } from '@tempo/db/schema';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { listAttachmentsForParents } from './attachments';

export type AppendPayload = Event extends infer E
  ? E extends { id: string; created_at: string }
    ? Omit<E, 'id' | 'created_at'>
    : never
  : never;

export async function appendEvent(threadId: string, payload: AppendPayload): Promise<Event> {
  const seqResult = await db.execute(
    sql`SELECT nextval(pg_get_serial_sequence('events', 'seq')) AS n`,
  );
  const row = seqResult.rows[0];
  if (!row) throw new Error('nextval returned no row');
  const seqStr = String(row.n);
  const id = newEventId(seqStr);
  const n = Number(seqStr);
  const created_at_date = new Date();
  const created_at = created_at_date.toISOString();
  const event = { id, created_at, ...payload } as Event;
  await db.insert(events).values({
    id,
    seq: n,
    thread_id: threadId,
    kind: event.kind,
    payload_json: stripAttachmentUrls(event) as unknown as Record<string, unknown>,
    created_at: created_at_date,
  });
  return event;
}

export async function readEventsAfter(threadId: string, cursor: string): Promise<Event[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.thread_id, threadId), gt(events.id, cursor)))
    .orderBy(asc(events.id));
  const stored = rows.map((r) => r.payload_json as unknown as Event);
  return resignAttachmentUrls(stored);
}

const STUB_URL = 'https://placeholder.invalid/' as const;
const STUB_EXPIRES = '1970-01-01T00:00:00.000Z' as const;

function stripAttachmentUrls(event: Event): Event {
  const stub = (a: AttachmentRef): AttachmentRef => ({
    ...a,
    url: STUB_URL,
    expires_at: STUB_EXPIRES,
  });
  if (event.kind === 'discussion_message_posted') {
    return {
      ...event,
      message: { ...event.message, attachments: event.message.attachments.map(stub) },
    };
  }
  if (event.kind === 'reply_added') {
    return { ...event, reply: { ...event.reply, attachments: event.reply.attachments.map(stub) } };
  }
  if (event.kind === 'comment_added') {
    return {
      ...event,
      comment: {
        ...event.comment,
        replies: event.comment.replies.map((r) => ({ ...r, attachments: r.attachments.map(stub) })),
      },
    };
  }
  return event;
}

async function resignAttachmentUrls(stored: Event[]): Promise<Event[]> {
  const messageIds = new Set<string>();
  const replyIds = new Set<string>();
  for (const e of stored) {
    if (e.kind === 'discussion_message_posted') messageIds.add(e.message.id);
    else if (e.kind === 'reply_added') replyIds.add(e.reply.id);
    else if (e.kind === 'comment_added') {
      for (const r of e.comment.replies) replyIds.add(r.id);
    }
  }
  if (messageIds.size === 0 && replyIds.size === 0) return stored;

  const byParent = await listAttachmentsForParents({
    message_ids: [...messageIds],
    reply_ids: [...replyIds],
  });
  const fresh = (parentId: string, refs: AttachmentRef[]): AttachmentRef[] => {
    const live = byParent.get(parentId) ?? [];
    return refs.flatMap((r) => {
      const match = live.find((a) => a.id === r.id);
      return match ? [match] : [];
    });
  };

  return stored.map((e) => {
    if (e.kind === 'discussion_message_posted') {
      return {
        ...e,
        message: { ...e.message, attachments: fresh(e.message.id, e.message.attachments) },
      };
    }
    if (e.kind === 'reply_added') {
      return { ...e, reply: { ...e.reply, attachments: fresh(e.reply.id, e.reply.attachments) } };
    }
    if (e.kind === 'comment_added') {
      return {
        ...e,
        comment: {
          ...e.comment,
          replies: e.comment.replies.map((r) => ({
            ...r,
            attachments: fresh(r.id, r.attachments),
          })),
        },
      };
    }
    return e;
  });
}

export async function latestEventId(threadId: string): Promise<string> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.thread_id, threadId))
    .orderBy(desc(events.id))
    .limit(1);
  return rows[0]?.id ?? newEventId(0);
}
