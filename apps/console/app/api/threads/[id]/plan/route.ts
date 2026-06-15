import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';
import { getPlan } from '../../../../../server/plan';
import { threadBelongsToWorkspace } from '../../../../../server/threads';

// GET — Console UI reads Plan body for the editor. POST is handled by Worker
// (migrated in slice 1c-2b; browser sends Bearer Clerk JWT to Worker).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && !(await threadBelongsToWorkspace(id, auth.workspace_id)))
    return err('unauthorized', 401);
  return ok(await getPlan(id));
}
