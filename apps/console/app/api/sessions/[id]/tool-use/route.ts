import { RecordToolUseRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { logger } from '../../../../../logger';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { recordAgentToolUse } from '../../../../../server/status';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  // Agent-only route: the Agent driver POSTs with the connect token. Reject any
  // other caller, and require the URL session id matches the session the token
  // resolved to — prevents one Thread's Agent from writing into another's feed.
  if (auth?.actor !== 'agent' || auth.session_id !== id) {
    return err('unauthorized', 401);
  }
  const parsed = await parseBody(req, RecordToolUseRequest);
  if (!parsed.ok) return parsed.response;
  try {
    await recordAgentToolUse(id, parsed.data.tool, parsed.data.summary);
  } catch (e) {
    if ((e as Error).message === 'session_not_found') return err('session_not_found', 404);
    logger.error({ err: e, sessionId: id, tool: parsed.data.tool }, 'tool-use 500');
    throw e;
  }
  return ok({ ok: true });
}
