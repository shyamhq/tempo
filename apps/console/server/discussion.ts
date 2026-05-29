import type { Actor, DiscussionMessage } from '@tempo/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { clarification_rounds, discussion_messages, threads } from '../db/schema';
import { appendEvent } from './event-log';
import { newMessageId } from './ids';
import { toIso } from './threads';

export async function listMessagesForThread(threadId: string): Promise<DiscussionMessage[]> {
  const rows = await db
    .select()
    .from(discussion_messages)
    .where(eq(discussion_messages.thread_id, threadId))
    .orderBy(asc(discussion_messages.created_at), asc(discussion_messages.id));
  return rows.map(shapeMessage);
}

export async function postMessage(
  threadId: string,
  author: Actor,
  text: string,
): Promise<DiscussionMessage> {
  // Single transaction so the freeze + round-pending checks observe the same
  // snapshot as the insert. SQLite serialises writers, so this also closes the
  // narrow race where two concurrent Dev posts both see no pending Round.
  const message = await db.transaction(async (tx) => {
    const [t] = await tx
      .select({ status: threads.status })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (!t) throw new Error('thread_not_found');
    if (t.status === 'approved') throw new Error('thread_approved');

    if (author === 'dev') {
      const pending = await tx
        .select({ id: clarification_rounds.id })
        .from(clarification_rounds)
        .where(
          and(
            eq(clarification_rounds.thread_id, threadId),
            eq(clarification_rounds.status, 'pending'),
          ),
        )
        .limit(1);
      if (pending.length > 0) throw new Error('round_pending');
    }

    const id = newMessageId();
    const created_at = new Date().toISOString();
    await tx
      .insert(discussion_messages)
      .values({ id, thread_id: threadId, author, text, created_at });
    return { id, thread_id: threadId, author, text, created_at };
  });
  await appendEvent(threadId, { kind: 'discussion_message_posted', message });
  return message;
}

function shapeMessage(row: typeof discussion_messages.$inferSelect): DiscussionMessage {
  return {
    id: row.id,
    thread_id: row.thread_id,
    author: row.author,
    text: row.text,
    created_at: toIso(row.created_at),
  };
}
