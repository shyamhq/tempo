import { UpdateThreadRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { listCommentsForThread } from '../../../../server/comments';
import { listMessagesForThread } from '../../../../server/discussion';
import { latestEventId } from '../../../../server/event-log';
import { err, ok, parseBody } from '../../../../server/http';
import { getPlan } from '../../../../server/plan';
import {
  deleteThread,
  getThread,
  latestAttachedRepo,
  latestSessionStatus,
  updateThread,
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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'dev') return err('unauthorized', 401);
  const parsed = await parseBody(req, UpdateThreadRequest);
  if (!parsed.ok) return parsed.response;
  const { id } = await ctx.params;
  try {
    const thread = await updateThread(id, parsed.data);
    return ok({ thread });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'thread_not_found') return err('thread_not_found', 404);
    if (msg === 'space_workspace_mismatch') return err('space_workspace_mismatch', 400);
    throw e;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const thread = await getThread(id);
  if (!thread) return err('thread_not_found', 404);
  const [plan, comments, messages, session_status, repo, last_event_id] = await Promise.all([
    getPlan(id),
    listCommentsForThread(id),
    listMessagesForThread(id),
    latestSessionStatus(id),
    latestAttachedRepo(id),
    latestEventId(id),
  ]);
  return ok({
    thread: { id: thread.id, title: thread.title, description: thread.description },
    status: thread.status,
    plan,
    comments,
    discussion: { messages },
    session_status,
    attached_repo_remote: repo.attached_repo_remote,
    attached_repo_path: repo.attached_repo_path,
    last_event_id,
  });
}
