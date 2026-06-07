import { WritePlanRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { getPlan, InvalidPlanBodyError, writePlan } from '../../../../../server/plan';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
