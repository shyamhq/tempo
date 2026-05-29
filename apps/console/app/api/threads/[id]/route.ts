import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { listCommentsForThread } from '../../../../server/comments';
import { latestEventId } from '../../../../server/event-log';
import { err, ok } from '../../../../server/http';
import { getPlan } from '../../../../server/plan';
import { getPendingRound } from '../../../../server/rounds';
import { latestActivity } from '../../../../server/status';
import {
  deleteThread,
  getThread,
  latestAttachedRepo,
  latestSessionStatus,
} from '../../../../server/threads';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'dev') return err('unauthorized', 401);
  const { id } = await ctx.params;
  try {
    await deleteThread(id);
  } catch (e) {
    if ((e as Error).message === 'thread_not_found') return err('thread_not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const thread = await getThread(id);
  if (!thread) return err('thread_not_found', 404);
  const [plan, pending_round, { active, archived }, session_status, repo, activity, last_event_id] =
    await Promise.all([
      getPlan(id),
      getPendingRound(id),
      listCommentsForThread(id),
      latestSessionStatus(id),
      latestAttachedRepo(id),
      latestActivity(id),
      latestEventId(id),
    ]);
  return ok({
    thread: { id: thread.id, title: thread.title, description: thread.description },
    status: thread.status,
    plan,
    pending_round,
    comments: active,
    archived_comments: archived,
    session_status,
    attached_repo_remote: repo.attached_repo_remote,
    attached_repo_path: repo.attached_repo_path,
    activity,
    last_event_id,
  });
}
