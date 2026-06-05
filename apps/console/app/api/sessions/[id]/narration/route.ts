import { RecordAgentNarrationRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { recordAgentNarration } from '../../../../../server/status';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  // Agent-only route: stream-pump POSTs with the connect token. Same auth
  // shape as /tool-use — the URL session id must match the token's session.
  if (auth?.actor !== 'agent' || auth.session_id !== id) {
    return err('unauthorized', 401);
  }
  const parsed = await parseBody(req, RecordAgentNarrationRequest);
  if (!parsed.ok) return parsed.response;
  try {
    await recordAgentNarration(id, parsed.data.text);
  } catch (e) {
    if ((e as Error).message === 'session_not_found') return err('session_not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}
