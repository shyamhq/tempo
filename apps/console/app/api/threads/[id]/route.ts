import { UpdateThreadRequest } from '@tempo/contracts/http';
import {
  deleteThread,
  getPlan,
  getThread,
  latestAttachedRepo,
  latestEventId,
  latestSessionStatus,
  listCommentsForThread,
  listMessagesForThread,
  threadBelongsToWorkspace,
  updateThread,
} from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok, parseBody, toResponse } from '../../../../server/http';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const { id } = await ctx.params;
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
  try {
    await deleteThread(id);
  } catch (e) {
    return toResponse(e);
  }
  return ok({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const { id } = await ctx.params;
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
  const parsed = await parseBody(req, UpdateThreadRequest);
  if (!parsed.ok) return parsed.response;
  // Agents may only edit Thread metadata (title, description). space_id and
  // sort_order are Dev-only — they reflect Dev workspace organisation that
  // the Agent has no business mutating, even on its own Thread.
  if (auth.actor === 'agent' && (parsed.data.space_id || parsed.data.sort_order !== undefined)) {
    return err('forbidden', 403);
  }
  try {
    const thread = await updateThread(id, parsed.data);
    return ok({ thread });
  } catch (e) {
    return toResponse(e);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const { id } = await ctx.params;
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
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
    space_id: thread.space_id,
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
