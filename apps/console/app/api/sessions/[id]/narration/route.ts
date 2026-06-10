import { RecordAgentNarrationRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest, readSessionHeader } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { sessionBelongsToWorkspace } from '../../../../../server/sessions';
import { recordAgentNarration } from '../../../../../server/status';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'agent') return err('unauthorized', 401);
  if (readSessionHeader(req) !== id) return err('unauthorized', 401);
  if (!(await sessionBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
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
