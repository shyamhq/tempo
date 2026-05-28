import type { Actor, Comment, Reply, ReplyPayload } from '@tempo/contracts';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db';
import { comments, replies } from '../db/schema';
import { appendEvent } from './event-log';
import { newCommentId } from './ids';
import { nowIso, toIso } from './threads';

export async function createComment(
  threadId: string,
  plan_quote: string,
  plan_context: string,
): Promise<Comment> {
  const id = newCommentId();
  await db.insert(comments).values({ id, thread_id: threadId, plan_quote, plan_context });
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

export async function listCommentsForThread(
  threadId: string,
): Promise<{ active: Comment[]; archived: Comment[] }> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.thread_id, threadId))
    .orderBy(asc(comments.created_at), asc(comments.id));
  if (rows.length === 0) return { active: [], archived: [] };
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
  const active: Comment[] = [];
  const archived: Comment[] = [];
  for (const row of rows) {
    const shaped = shapeComment(row, grouped.get(row.id) ?? []);
    if (row.archived_at) archived.push(shaped);
    else active.push(shaped);
  }
  return { active, archived };
}

export async function resolveComment(commentId: string, by: Actor): Promise<void> {
  const [row] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!row) throw new Error('comment_not_found');
  await db.update(comments).set({ resolved_by: by }).where(eq(comments.id, commentId));
  await appendEvent(row.thread_id, {
    kind: 'comment_resolved',
    comment_id: commentId,
    actor: by,
  });
}

export async function unresolveComment(commentId: string, by: Actor): Promise<void> {
  const [row] = await db
    .select({ thread_id: comments.thread_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!row) throw new Error('comment_not_found');
  await db.update(comments).set({ resolved_by: null }).where(eq(comments.id, commentId));
  await appendEvent(row.thread_id, {
    kind: 'comment_unresolved',
    comment_id: commentId,
    actor: by,
  });
}

// Fuzzy-match plan_quote+plan_context against the new plan body. If neither
// the quote nor a Levenshtein-near variant is locatable, archive the comment.
// Called by writePlan after every plan update.
export async function reconcileCommentAnchors(
  threadId: string,
  planMarkdown: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.thread_id, threadId),
        isNull(comments.archived_at),
        isNotNull(comments.plan_quote),
      ),
    );
  const archivedAt = nowIso();
  for (const c of rows) {
    if (matches(planMarkdown, c.plan_quote, c.plan_context)) continue;
    await db.update(comments).set({ archived_at: archivedAt }).where(eq(comments.id, c.id));
    await appendEvent(threadId, { kind: 'comment_archived', comment_id: c.id });
  }
}

function matches(haystack: string, quote: string, context: string): boolean {
  if (haystack.includes(quote)) return true;
  if (context && haystack.includes(context)) return true;
  // Fallback: Levenshtein over a window around best partial overlap. Cheap heuristic:
  // accept if the closest substring of length |quote| has distance <= 15% of |quote|.
  const tolerance = Math.max(2, Math.floor(quote.length * 0.15));
  return findApprox(haystack, quote, tolerance);
}

function findApprox(haystack: string, needle: string, tolerance: number): boolean {
  if (needle.length === 0) return true;
  const step = Math.max(1, Math.floor(needle.length / 4));
  for (let i = 0; i + needle.length <= haystack.length; i += step) {
    const window = haystack.slice(i, i + needle.length);
    if (levenshtein(window, needle, tolerance) <= tolerance) return true;
  }
  return false;
}

function levenshtein(a: string, b: string, ceiling: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > ceiling) return ceiling + 1;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > ceiling) return ceiling + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
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
    archived_at: row.archived_at ? toIso(row.archived_at) : null,
    created_at: toIso(row.created_at),
    replies: replyRows.map(shapeReply),
  };
}

function shapeReply(row: typeof replies.$inferSelect): Reply {
  return {
    id: row.id,
    comment_id: row.comment_id,
    author: row.author,
    payload: shapeReplyPayload(row),
    proposal_status: row.proposal_status,
    rejection_reason: row.rejection_reason,
    created_at: toIso(row.created_at),
  };
}

function shapeReplyPayload(row: typeof replies.$inferSelect): ReplyPayload {
  switch (row.payload_type) {
    case 'text':
      return { type: 'text', text: row.text ?? '' };
    case 'edit_done':
      return { type: 'edit_done', text: row.text ?? '', section_ref: row.section_ref ?? '' };
    case 'edit_proposed':
      return {
        type: 'edit_proposed',
        text: row.text ?? '',
        target_section: row.target_section ?? '',
        replacement: row.replacement ?? '',
      };
  }
}

export { shapeReply };
