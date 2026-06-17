import type { AttachmentRef, DiscussionMessage, Mention, Question } from '@tempo/contracts';
import type { PostDiscussionMessageInput } from '@tempo/contracts/mcp';
import { db } from '@tempo/db/client';
import { discussion_messages, threads } from '@tempo/db/schema';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { z } from 'zod';
import {
  insertAttachmentRows,
  listAttachmentsForParents,
  verifyAttachmentsInR2,
} from './attachments';
import { appendEvent } from './event-log';
import { newMessageId } from './ids';

export async function listMessagesForThread(threadId: string): Promise<DiscussionMessage[]> {
  const rows = await db
    .select()
    .from(discussion_messages)
    .where(eq(discussion_messages.thread_id, threadId))
    .orderBy(asc(discussion_messages.created_at), asc(discussion_messages.id));
  if (rows.length === 0) return [];
  const attsByMessage = await listAttachmentsForParents({
    message_ids: rows.map((r) => r.id),
  });
  return rows.map((row) => shapeMessage(row, attsByMessage.get(row.id) ?? []));
}

export async function postMessage(
  threadId: string,
  author_user_id: string | null,
  body: z.infer<typeof PostDiscussionMessageInput>,
): Promise<DiscussionMessage> {
  // Only the Agent (null author_user_id) may post questions.
  if (author_user_id !== null && body.questions !== undefined) {
    throw new Error('invalid_input');
  }
  if (body.text === undefined && body.questions === undefined && body.attachments.length === 0) {
    throw new Error('invalid_input');
  }
  const questions: Question[] | null = body.questions
    ? body.questions.map((q) => ({ ...q, id: `q_${ulid()}` }))
    : null;
  const text = body.text ?? null;
  const mentions: Mention[] | null = body.mentions ?? null;

  const heads = await verifyAttachmentsInR2(threadId, body.attachments);

  const message = await db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (!t) throw new Error('thread_not_found');

    const id = newMessageId();
    const created_at = new Date();
    await tx
      .insert(discussion_messages)
      .values({ id, thread_id: threadId, author_user_id, text, questions, mentions, created_at });
    await insertAttachmentRows(tx, threadId, heads, { kind: 'message', messageId: id });
    return { id, created_at_iso: created_at.toISOString() };
  });

  const attsByMessage = await listAttachmentsForParents({ message_ids: [message.id] });
  const shaped: DiscussionMessage = {
    id: message.id,
    thread_id: threadId,
    author_user_id,
    text,
    questions,
    mentions,
    attachments: attsByMessage.get(message.id) ?? [],
    created_at: message.created_at_iso,
  };
  await appendEvent(threadId, { kind: 'discussion_message_posted', message: shaped });
  return shaped;
}

function shapeMessage(
  row: typeof discussion_messages.$inferSelect,
  attachments: AttachmentRef[],
): DiscussionMessage {
  return {
    id: row.id,
    thread_id: row.thread_id,
    author_user_id: row.author_user_id,
    text: row.text,
    questions: row.questions as Question[] | null,
    mentions: row.mentions as Mention[] | null,
    attachments,
    created_at: row.created_at.toISOString(),
  };
}
