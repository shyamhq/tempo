import type { Comment, Reply } from '@tempo/contracts';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { comments, replies } from '../db/schema';
import { appendEvent } from './event-log';
import { newCommentId, newReplyId } from './ids';
import { toIso } from './threads';

export async function createComment(
  threadId: string,
  plan_quote: string,
  plan_context: string,
  first_reply_text?: string,
): Promise<Comment> {
  const id = newCommentId();
  // Wrap the two inserts so a reply-row failure can't leave an empty comment
  // committed — without this the `comment_added` event would fire with an
  // empty `replies` array and the Agent would get nudged for nothing.
  await db.transaction(async (tx) => {
    await tx.insert(comments).values({ id, thread_id: threadId, plan_quote, plan_context });
    if (first_reply_text) {
      await tx
        .insert(replies)
        .values({ id: newReplyId(), comment_id: id, author: 'dev', text: first_reply_text });
    }
  });
  const comment = await loadComment(id);
  await appendEvent(threadId, { kind: 'comment_added', comment });
  return comment;
}

async function loadComment(commentId: string): Promise<Comment> {
  const [row] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!row) throw new Error(`comment ${commentId} not found`);
  const replyRows = await db
    .select()
    .from(replies)
    .where(eq(replies.comment_id, commentId))
    .orderBy(asc(replies.created_at), asc(replies.id));
  return shapeComment(row, replyRows);
}

export async function listCommentsForThread(threadId: string): Promise<Comment[]> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.thread_id, threadId))
    .orderBy(asc(comments.created_at), asc(comments.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const replyRows = await db
    .select()
    .from(replies)
    .where(inArray(replies.comment_id, ids))
    .orderBy(asc(replies.created_at), asc(replies.id));
  const grouped = new Map<string, typeof replyRows>();
  for (const r of replyRows) {
    const arr = grouped.get(r.comment_id) ?? [];
    arr.push(r);
    grouped.set(r.comment_id, arr);
  }
  return rows.map((row) => shapeComment(row, grouped.get(row.id) ?? []));
}

export const resolveComment = (commentId: string) =>
  setResolvedBy(commentId, 'dev', 'comment_resolved');

export const unresolveComment = (commentId: string) =>
  setResolvedBy(commentId, null, 'comment_unresolved');

async function setResolvedBy(
  commentId: string,
  resolved_by: 'dev' | null,
  eventKind: 'comment_resolved' | 'comment_unresolved',
): Promise<void> {
  const [row] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!row) throw new Error('comment_not_found');
  await db.update(comments).set({ resolved_by }).where(eq(comments.id, commentId));
  await appendEvent(row.thread_id, { kind: eventKind, comment_id: commentId });
}

function shapeComment(
  row: typeof comments.$inferSelect,
  replyRows: (typeof replies.$inferSelect)[],
): Comment {
  return {
    id: row.id,
    thread_id: row.thread_id,
    plan_quote: row.plan_quote,
    plan_context: row.plan_context,
    resolved_by: row.resolved_by,
    created_at: toIso(row.created_at),
    replies: replyRows.map(shapeReply),
  };
}

function shapeReply(row: typeof replies.$inferSelect): Reply {
  return {
    id: row.id,
    comment_id: row.comment_id,
    author: row.author,
    payload: { text: row.text ?? '' },
    created_at: toIso(row.created_at),
  };
}

export { shapeReply };
