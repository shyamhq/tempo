import type { AttachmentRef, Comment, Mention, Reply } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import { comments, replies } from '@tempo/db/schema';
import { NotFoundError } from '@tempo/errors';
import { asc, eq, inArray } from 'drizzle-orm';
import {
  insertAttachmentRows,
  listAttachmentsForParents,
  verifyAttachmentsInR2,
} from './attachments';
import { appendEvent } from './event-log';
import { newCommentId, newReplyId } from './ids';

export type CreateCommentInput = {
  threadId: string;
  plan_quote: string;
  plan_context: string;
  anchor_block_id: string | null;
  author_user_id: string | null;
  first_reply_text?: string;
  first_reply_mentions?: Mention[] | null;
  attachment_ids?: string[];
};

export async function createComment(input: CreateCommentInput): Promise<Comment> {
  const {
    threadId,
    plan_quote,
    plan_context,
    anchor_block_id,
    author_user_id,
    first_reply_text,
    first_reply_mentions,
  } = input;
  const attachment_ids = input.attachment_ids ?? [];

  const id = newCommentId();
  const replyId = first_reply_text || attachment_ids.length > 0 ? newReplyId() : null;
  const heads = replyId ? await verifyAttachmentsInR2(threadId, attachment_ids) : [];

  await db.transaction(async (tx) => {
    await tx.insert(comments).values({
      id,
      thread_id: threadId,
      plan_quote,
      plan_context,
      anchor_block_id,
      author_user_id,
    });
    if (replyId) {
      await tx.insert(replies).values({
        id: replyId,
        comment_id: id,
        author_user_id,
        mentions: first_reply_mentions ?? null,
        text: first_reply_text ?? '',
      });
      await insertAttachmentRows(tx, threadId, heads, { kind: 'reply', replyId });
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
  const atts = await listAttachmentsForParents({ reply_ids: replyRows.map((r) => r.id) });
  return shapeComment(row, replyRows, atts);
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
  const atts = await listAttachmentsForParents({ reply_ids: replyRows.map((r) => r.id) });
  const grouped = new Map<string, typeof replyRows>();
  for (const r of replyRows) {
    const arr = grouped.get(r.comment_id) ?? [];
    arr.push(r);
    grouped.set(r.comment_id, arr);
  }
  return rows.map((row) => shapeComment(row, grouped.get(row.id) ?? [], atts));
}

export const resolveComment = (commentId: string, userId: string | null) =>
  setResolvedBy(commentId, userId, 'comment_resolved');

export const unresolveComment = (commentId: string) =>
  setResolvedBy(commentId, null, 'comment_unresolved');

export async function deleteComment(commentId: string): Promise<void> {
  const [row] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!row) throw new NotFoundError(`comment_not_found: ${commentId}`);

  await db.transaction(async (tx) => {
    await tx.delete(replies).where(eq(replies.comment_id, commentId));
    await tx.delete(comments).where(eq(comments.id, commentId));
  });
  await appendEvent(row.thread_id, { kind: 'comment_deleted', comment_id: commentId });
}

async function setResolvedBy(
  commentId: string,
  resolved_by_user_id: string | null,
  eventKind: 'comment_resolved' | 'comment_unresolved',
): Promise<void> {
  const [row] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!row) throw new NotFoundError(`comment_not_found: ${commentId}`);
  await db.update(comments).set({ resolved_by_user_id }).where(eq(comments.id, commentId));
  await appendEvent(row.thread_id, { kind: eventKind, comment_id: commentId });
}

function shapeComment(
  row: typeof comments.$inferSelect,
  replyRows: (typeof replies.$inferSelect)[],
  attsByReply: Map<string, AttachmentRef[]>,
): Comment {
  return {
    id: row.id,
    thread_id: row.thread_id,
    plan_quote: row.plan_quote,
    plan_context: row.plan_context,
    anchor_block_id: row.anchor_block_id,
    author_user_id: row.author_user_id,
    resolved_by_user_id: row.resolved_by_user_id,
    created_at: row.created_at.toISOString(),
    replies: replyRows.map((r) => shapeReply(r, attsByReply.get(r.id) ?? [])),
  };
}

function shapeReply(row: typeof replies.$inferSelect, attachments: AttachmentRef[]): Reply {
  return {
    id: row.id,
    comment_id: row.comment_id,
    author_user_id: row.author_user_id,
    payload: { text: row.text ?? '' },
    mentions: row.mentions as Mention[] | null,
    attachments,
    created_at: row.created_at.toISOString(),
  };
}

export { shapeReply };
