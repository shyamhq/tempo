import type { Actor, Reply, ReplyPayload } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { comments, replies } from '../db/schema';
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
  author: Actor,
  attachment_ids: string[] = [],
): Promise<Reply> {
  const [c] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!c) throw new Error('comment_not_found');

  const heads = await verifyAttachmentsInR2(c.thread_id, attachment_ids);
  const id = newReplyId();
  await db.transaction(async (tx) => {
    await tx.insert(replies).values({
      id,
      comment_id: commentId,
      author,
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
