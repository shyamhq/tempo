import { OpenRoundRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { err, ok, parseBody } from '../../../../../server/http';
import { openRound } from '../../../../../server/rounds';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, OpenRoundRequest);
  if (!parsed.ok) return parsed.response;
  const result = await openRound(id, parsed.data.questions);
  if (!result.ok) return err(result.error, 409);
  return ok({ round_id: result.round.id }, 201);
}
