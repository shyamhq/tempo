import type { Actor, AttachmentRef, DiscussionMessage, Question } from '@tempo/contracts';
import type { PostDiscussionMessageInput } from '@tempo/contracts/mcp';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { z } from 'zod';
import { db } from '../db';
import { discussion_messages, threads } from '../db/schema';
import {
  insertAttachmentRows,
  listAttachmentsForParents,
  verifyAttachmentsInR2,
} from './attachments';
import { appendEvent } from './event-log';
import { newMessageId } from './ids';
import { toIso } from './threads';

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

// Single insert path for both Agent question-posts and Dev/Agent prose. The
// `author='dev'` + `questions` combo is rejected here, not in the route —
// route handlers stay thin.
export async function postMessage(
  threadId: string,
  author: Actor,
  body: z.infer<typeof PostDiscussionMessageInput>,
): Promise<DiscussionMessage> {
  if (author === 'dev' && body.questions !== undefined) {
    throw new Error('invalid_input');
  }
  if (body.text === undefined && body.questions === undefined && body.attachments.length === 0) {
    throw new Error('invalid_input');
  }
  const questions: Question[] | null = body.questions
    ? body.questions.map((q) => ({ ...q, id: `q_${ulid()}` }))
    : null;
  const text = body.text ?? null;

  // Verify R2 objects before opening the write tx — HEAD calls can be slow
  // and we want to fail before locking the row. The verified heads are
  // then trusted inside the tx.
  const heads = await verifyAttachmentsInR2(threadId, body.attachments);

  const message = await db.transaction(async (tx) => {
    const [t] = await tx
      .select({ status: threads.status })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (!t) throw new Error('thread_not_found');
    if (t.status === 'approved') throw new Error('thread_approved');

    const id = newMessageId();
    const created_at = new Date().toISOString();
    await tx
      .insert(discussion_messages)
      .values({ id, thread_id: threadId, author, text, questions, created_at });
    await insertAttachmentRows(tx, threadId, heads, { kind: 'message', messageId: id });
    return { id, created_at };
  });

  const attsByMessage = await listAttachmentsForParents({ message_ids: [message.id] });
  const shaped: DiscussionMessage = {
    id: message.id,
    thread_id: threadId,
    author,
    text,
    questions,
    attachments: attsByMessage.get(message.id) ?? [],
    created_at: message.created_at,
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
    author: row.author,
    text: row.text,
    questions: row.questions as Question[] | null,
    attachments,
    created_at: toIso(row.created_at),
  };
}
