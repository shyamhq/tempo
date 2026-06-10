import { RecordToolUseRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { logger } from '../../../../../logger';
import { authFromRequest, readSessionHeader } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { sessionBelongsToWorkspace } from '../../../../../server/sessions';
import { recordAgentToolUse } from '../../../../../server/status';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  // Agent-only route. The CLI sends `X-Tempo-Session` on every request after
  // handshake; it must match the URL id, and the session must belong to a
  // thread in the agent's workspace.
  if (auth?.actor !== 'agent') return err('unauthorized', 401);
  if (readSessionHeader(req) !== id) return err('unauthorized', 401);
  if (!(await sessionBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
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
