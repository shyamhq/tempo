import type { Mention, Reply, ReplyPayload } from '@tempo/contracts';
import { db } from '@tempo/db/client';
import { comments, replies } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import {
  insertAttachmentRows,
  listAttachmentsForParents,
  verifyAttachmentsInR2,
} from './attachments';
import { shapeReply } from './comments';
import { appendEvent } from './event-log';
import { newReplyId } from './ids';

export async function postReply(
  commentId: string,
  payload: ReplyPayload,
  author_user_id: string | null,
  mentions: Mention[] | null,
  attachment_ids: string[] = [],
  // Optional caller-asserted thread scope. When set, refuses if the comment
  // lives in a different thread — closes a cross-thread write the MCP tool
  // path would otherwise allow (the hosted JWT scopes the caller to one
  // thread, but the comment_id arg is otherwise untrusted).
  expectedThreadId?: string,
): Promise<Reply> {
  const [c] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!c) throw new Error('comment_not_found');
  if (expectedThreadId && c.thread_id !== expectedThreadId) {
    throw new Error('forbidden');
  }

  const heads = await verifyAttachmentsInR2(c.thread_id, attachment_ids);
  const id = newReplyId();
  await db.transaction(async (tx) => {
    await tx.insert(replies).values({
      id,
      comment_id: commentId,
      author_user_id,
      mentions,
      text: payload.text,
    });
    await insertAttachmentRows(tx, c.thread_id, heads, { kind: 'reply', replyId: id });
  });
  const [row] = await db.select().from(replies).where(eq(replies.id, id)).limit(1);
  if (!row) throw new Error('reply insert failed');
  const atts = await listAttachmentsForParents({ reply_ids: [id] });
  const reply = shapeReply(row, atts.get(id) ?? []);
  await appendEvent(c.thread_id, { kind: 'reply_added', comment_id: commentId, reply });
  return reply;
}
