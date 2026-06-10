import { WritePlanRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest, authorOf } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { getPlan, InvalidPlanBodyError, writePlan } from '../../../../../server/plan';

// Single Plan endpoint for both Dev (Console) and Agent. The body shape is
// identical for both — pm_json — so the route returns the same payload for
// either actor; the contract type label (`Plan` vs `AgentPlanState`) differs
// but the runtime JSON does not.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && auth.thread_id !== id) return err('unauthorized', 401);
  return ok(await getPlan(id));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && auth.thread_id !== id) return err('unauthorized', 401);
  const parsed = await parseBody(req, WritePlanRequest);
  if (!parsed.ok) return parsed.response;
  try {
    const { updated_at } = await writePlan(id, parsed.data.pm_json, authorOf(auth));
    return ok({ ok: true, updated_at });
  } catch (e) {
    if (e instanceof InvalidPlanBodyError) return err('invalid_plan_body', 400);
    throw e;
  }
}
