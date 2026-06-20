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
  // `repos` is Dev-only, enforced here (not in the schema) exactly as `questions`
  // is Agent-only above: only a Dev author may attach repos to the Thread. The
  // Agent's `body.repos`, if any, is ignored.
  const repos = author_user_id !== null ? body.repos : undefined;
  const questions: Question[] | null = body.questions
    ? body.questions.map((q) => ({ ...q, id: `q_${ulid()}` }))
    : null;
  const text = body.text ?? null;
  const mentions: Mention[] | null = body.mentions ?? null;

  const heads = await verifyAttachmentsInR2(threadId, body.attachments);

  const { message, reposLinked } = await db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: threads.id, repos: threads.repos })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (!t) throw new Error('thread_not_found');

    // Diff the Dev-sent repo list against the Thread's current list; on a change,
    // update the column inside this transaction so the message and the new repo
    // set commit atomically. The `repo_linked` event is appended after commit.
    const reposLinked = repos !== undefined && !sameRepos(t.repos, repos);
    if (reposLinked) await tx.update(threads).set({ repos }).where(eq(threads.id, threadId));

    const id = newMessageId();
    const created_at = new Date();
    await tx
      .insert(discussion_messages)
      .values({ id, thread_id: threadId, author_user_id, text, questions, mentions, created_at });
    await insertAttachmentRows(tx, threadId, heads, { kind: 'message', messageId: id });
    return { message: { id, created_at_iso: created_at.toISOString() }, reposLinked };
  });

  if (reposLinked && repos !== undefined) {
    await appendEvent(threadId, { kind: 'repo_linked', repos });
  }

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

// Order-independent set comparison: the Dev sends the full updated repo list,
// so a reorder of the same repos is not a change and must not re-emit
// `repo_linked` (which would wake the Agent for nothing). Compares de-duplicated
// sets so a list with repeats (e.g. ["x","x"] vs ["x","y"]) isn't a false match.
export function sameRepos(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((r) => setB.has(r));
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
