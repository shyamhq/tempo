import {
  getHostedState,
  getPlan,
  getThread,
  isPresent,
  listCommentsForThread,
  listMessagesForThread,
  resolveAgentPresent,
  threadBelongsToWorkspace,
} from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok } from '../../../../server/http';

// GET /api/threads/:id — hydration. Assembles GetThreadResponse: thread meta +
// plan + comments + discussion + live presence/vm. Mirrors
// apps/console/app/api/threads/[id]/route.ts (GET only; the rewrite has no
// thread DELETE/PATCH in T2.3).
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
