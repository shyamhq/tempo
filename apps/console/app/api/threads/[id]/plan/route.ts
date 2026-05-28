import { WritePlanRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { getPlan, writePlan } from '../../../../../server/plan';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return ok(await getPlan(id));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const parsed = await parseBody(req, WritePlanRequest);
  if (!parsed.ok) return parsed.response;
  const { updated_at } = await writePlan(id, parsed.data.markdown, auth.actor);
  return ok({ ok: true, updated_at });
}
