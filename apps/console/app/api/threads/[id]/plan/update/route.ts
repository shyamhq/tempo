import { UpdatePlanInput } from '@tempo/contracts/mcp';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../../server/http';
import { InvalidPlanBodyError, PlanNotEmptyError, updatePlan } from '../../../../../../server/plan';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && auth.thread_id !== id) return err('unauthorized', 401);
  // Agent-only. The Dev composes the first draft in the editor, which goes
  // through `POST /plan` (pm_json); this one-shot HTML init exists for the
  // Agent's `tempo_update_plan` tool.
  if (auth.actor !== 'agent') return err('forbidden', 403);
  const parsed = await parseBody(req, UpdatePlanInput);
  if (!parsed.ok) return parsed.response;
  try {
    const { ids } = await updatePlan(id, parsed.data.html, auth.actor);
    return ok({ ok: true, ids });
  } catch (e) {
    if (e instanceof PlanNotEmptyError) return err('plan_not_empty', 409, e.message);
    if (e instanceof InvalidPlanBodyError) return err('invalid_plan_body', 400, e.message);
    throw e;
  }
}
