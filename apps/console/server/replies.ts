import type { Actor, ProposalStatus, Reply, ReplyPayload } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { comments, replies } from '../db/schema';
import { shapeReply } from './comments';
import { appendEvent } from './event-log';
import { newReplyId } from './ids';

export async function postReply(
  commentId: string,
  payload: ReplyPayload,
  author: Actor,
): Promise<Reply> {
  const [c] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!c) throw new Error('comment_not_found');
  const id = newReplyId();
  await db.insert(replies).values({
    id,
    comment_id: commentId,
    author,
    payload_type: payload.type,
    text: 'text' in payload ? payload.text : null,
    section_ref: payload.type === 'edit_done' ? payload.section_ref : null,
    target_section: payload.type === 'edit_proposed' ? payload.target_section : null,
    replacement: payload.type === 'edit_proposed' ? payload.replacement : null,
  });
  const [row] = await db.select().from(replies).where(eq(replies.id, id)).limit(1);
  if (!row) throw new Error('reply insert failed');
  const reply = shapeReply(row);
  await appendEvent(c.thread_id, { kind: 'reply_added', comment_id: commentId, reply });
  return reply;
}

export async function decideProposal(
  replyId: string,
  decision: ProposalStatus,
  rejection_reason?: string | null,
): Promise<void> {
  const [row] = await db.select().from(replies).where(eq(replies.id, replyId)).limit(1);
  if (!row) throw new Error('reply_not_found');
  if (row.payload_type !== 'edit_proposed') throw new Error('not_a_proposal');
  const [c] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, row.comment_id))
    .limit(1);
  if (!c) throw new Error('comment_not_found');
  await db
    .update(replies)
    .set({ proposal_status: decision, rejection_reason: rejection_reason ?? null })
    .where(eq(replies.id, replyId));
  await appendEvent(c.thread_id, {
    kind: 'proposal_decided',
    reply_id: replyId,
    decision,
    rejection_reason: rejection_reason ?? null,
  });
}
