import { DecideProposalRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { decideProposal } from '../../../../../server/replies';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const parsed = await parseBody(req, DecideProposalRequest);
  if (!parsed.ok) return parsed.response;
  try {
    await decideProposal(id, parsed.data.decision, parsed.data.rejection_reason);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'reply_not_found') return err('reply_not_found', 404);
    if (msg === 'not_a_proposal') return err('not_a_proposal', 400);
    throw e;
  }
  return ok({ ok: true });
}
