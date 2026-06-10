import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';
import { markSessionDisconnected } from '../../../../../server/sessions';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'agent') return err('unauthorized', 401);
  const { id } = await ctx.params;
  // Closes cross-thread IDOR: a Bearer token bound to thread A resolves to
  // session_id on thread A and cannot match a session_id on thread B. Does
  // NOT close same-thread reconnect: connect_token is per-thread (not per-
  // session), so an old CLI's token still resolves to the newest session of
  // that thread. Acceptable for MVP — the CLI token is a long-lived secret.
  if (auth.session_id !== id) return err('unauthorized', 401);
  await markSessionDisconnected(id);
  return ok({});
}
