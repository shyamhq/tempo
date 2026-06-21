import { UpdateThreadRequest } from '@tempo/contracts/http';
import {
  deleteThread,
  getHostedState,
  getPlan,
  getThread,
  isPresent,
  listCommentsForThread,
  listMessagesForThread,
  resolveAgentPresent,
  threadBelongsToWorkspace,
  updateThread,
} from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok, parseBody, toResponse } from '../../../../server/http';

// PATCH /api/threads/:id — rename / move / reorder, used by the sidebar's inline
// rename and the row menu's move-to. space_id and sort_order stay Dev-only.
// Mirrors apps/console/app/api/threads/[id]/route.ts.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const { id } = await ctx.params;
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
  const parsed = await parseBody(req, UpdateThreadRequest);
  if (!parsed.ok) return parsed.response;
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

// DELETE /api/threads/:id — the sidebar row menu's delete (after confirm).
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

// GET /api/threads/:id — hydration. Assembles GetThreadResponse: thread meta +
// plan + comments + discussion + live presence/vm. Mirrors
// apps/console/app/api/threads/[id]/route.ts.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const { id } = await ctx.params;
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
  const thread = await getThread(id);
  if (!thread) return err('thread_not_found', 404);
  const [plan, comments, messages, redisPresent, hosted] = await Promise.all([
    getPlan(id),
    listCommentsForThread(id),
    listMessagesForThread(id),
    isPresent(id),
    getHostedState(id),
  ]);
  // A repo-less Hosted Thread runs in-process (no SSE connection, no Redis
  // presence key) but is always reachable — see resolveAgentPresent.
  const agent_present = resolveAgentPresent(thread.agent_type, thread.repos, redisPresent);
  return ok({
    thread: {
      id: thread.id,
      title: thread.title,
      description: thread.description,
      agent_type: thread.agent_type,
    },
    space_id: thread.space_id,
    plan,
    comments,
    discussion: { messages },
    agent_present,
    vm: hosted.vm,
  });
}
