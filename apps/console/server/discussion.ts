import type { Actor, DiscussionMessage, Question } from '@tempo/contracts';
import type { PostDiscussionMessageInput } from '@tempo/contracts/mcp';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { z } from 'zod';
import { db } from '../db';
import { discussion_messages, threads } from '../db/schema';
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
  if (body.text === undefined && body.questions === undefined) {
    throw new Error('invalid_input');
  }
  const questions: Question[] | null = body.questions
    ? body.questions.map((q) => ({ ...q, id: `q_${ulid()}` }))
    : null;
  const text = body.text ?? null;

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
    return { id, thread_id: threadId, author, text, questions, created_at };
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
    questions: row.questions as Question[] | null,
    created_at: toIso(row.created_at),
  };
}
