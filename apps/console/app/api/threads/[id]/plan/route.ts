import { WritePlanRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import {
  getPlan,
  getPlanForAgent,
  InvalidPlanBodyError,
  writePlan,
} from '../../../../../server/plan';

// Single Plan endpoint for both Dev (Console) and Agent. The actor in
// authFromRequest decides which getter runs — getPlan returns the Console
// `Plan` shape; getPlanForAgent returns the `AgentPlanState` projection.
// Both bodies carry the same `pm_json` payload now that the Markdown
// sentinel pipeline is gone; the actor-aware GET preserves the type
// labelling at the contract boundary.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (auth?.actor === 'agent') {
    if (auth.thread_id !== id) return err('unauthorized', 401);
    return ok(await getPlanForAgent(id));
  }
  return ok(await getPlan(id));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  // Agents must be scoped to their own thread; Devs are global within the
  // single-user Console.
  if (auth.actor === 'agent' && auth.thread_id !== id) return err('unauthorized', 401);
  const parsed = await parseBody(req, WritePlanRequest);
  if (!parsed.ok) return parsed.response;
  try {
    const { updated_at } = await writePlan(id, parsed.data.pm_json, auth.actor);
    return ok({ ok: true, updated_at });
  } catch (e) {
    if (e instanceof InvalidPlanBodyError) return err('invalid_plan_body', 400);
    throw e;
  }
}
