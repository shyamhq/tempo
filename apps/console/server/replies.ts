import type { Actor, ProposalStatus, Reply, ReplyPayload } from '@tempo/contracts';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { comments, plans, replies } from '../db/schema';
import { shapeReply } from './comments';
import { appendEvent } from './event-log';
import { newReplyId } from './ids';
import { writePlan } from './plan';

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
  by: Actor,
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

  if (decision === 'accepted') {
    await applyReplacement(c.thread_id, row.target_section ?? '', row.replacement ?? '', by);
  }
}

// Dumb heading match: find a markdown heading line whose trimmed text matches
// target_section (case-insensitive substring), replace the block from that
// heading through (but not including) the next heading of equal or lower depth.
async function applyReplacement(
  threadId: string,
  targetSection: string,
  replacement: string,
  by: Actor,
): Promise<void> {
  const [p] = await db
    .select({ body_markdown: plans.body_markdown })
    .from(plans)
    .where(eq(plans.thread_id, threadId))
    .limit(1);
  const current = p?.body_markdown ?? '';
  const next = replaceSection(current, targetSection, replacement);
  if (next === current) return;
  await writePlan(threadId, next, by);
}

function replaceSection(markdown: string, target: string, replacement: string): string {
  const lines = markdown.split('\n');
  const target_lc = target.trim().toLowerCase();
  if (!target_lc) return markdown;
  let start = -1;
  let startDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const text = m[2]!.trim().toLowerCase();
    if (text.includes(target_lc)) {
      start = i;
      startDepth = m[1]!.length;
      break;
    }
  }
  if (start === -1) return markdown;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]!);
    if (m && m[1]!.length <= startDepth) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(end).join('\n');
  return [before, replacement, after].filter((s) => s.length > 0).join('\n');
}
