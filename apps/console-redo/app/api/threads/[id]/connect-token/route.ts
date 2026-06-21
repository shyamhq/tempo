import { getConnectToken, threadBelongsToWorkspace } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, toResponse } from '../../../../../server/http';

// GET /api/threads/:id/connect-token — Dev re-display of the Thread's stable
// connect token (the in-thread "Connect" affordance). Workspace-scoped: a forged
// id for a foreign workspace's Thread is rejected before the token is read.
// Mirrors apps/console/app/api/threads/[id]/connect-token/route.ts.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const { id } = await ctx.params;
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
  try {
    return ok(await getConnectToken(id));
  } catch (e) {
    if ((e as Error).message === 'thread_not_found') return err('thread_not_found', 404);
    return toResponse(e);
  }
}
