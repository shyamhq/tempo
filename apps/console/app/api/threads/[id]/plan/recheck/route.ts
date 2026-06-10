import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../../server/actor';
import { err, ok } from '../../../../../../server/http';
import { requestPlanRecheck, ThreadNotFoundError } from '../../../../../../server/plan';

// Dev-initiated nudge. Appends a `plan_edited_by_dev` event so the Agent's
// next poll picks up the cue to re-read the Plan. Dev-only by intent —
// nothing the Agent would ever do calls a "please re-read yourself" path.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  try {
    const { updated_at } = await requestPlanRecheck(id);
    return ok({ ok: true, updated_at });
  } catch (e) {
    if (e instanceof ThreadNotFoundError) return err('thread_not_found', 404);
    throw e;
  }
}
