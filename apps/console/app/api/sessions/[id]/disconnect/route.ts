import type { NextRequest } from 'next/server';
import { authFromRequest, readSessionHeader } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';
import { markSessionDisconnected, sessionBelongsToWorkspace } from '../../../../../server/sessions';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'agent') return err('unauthorized', 401);
  const { id } = await ctx.params;
  // The CLI sends `X-Tempo-Session` on every request after handshake. The
  // header must match the URL id, and the session must live in the agent's
  // workspace — workspace-scoped keys can otherwise reach any session id
  // they happen to know.
  if (readSessionHeader(req) !== id) return err('unauthorized', 401);
  if (!(await sessionBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
  await markSessionDisconnected(id);
  return ok({});
}
