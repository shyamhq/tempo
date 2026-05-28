import { AnswerRoundRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { err, ok, parseBody } from '../../../../../server/http';
import { answerRound } from '../../../../../server/rounds';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, AnswerRoundRequest);
  if (!parsed.ok) return parsed.response;
  try {
    await answerRound(id, parsed.data.answers);
  } catch (e) {
    if ((e as Error).message === 'round_not_found') return err('round_not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}
