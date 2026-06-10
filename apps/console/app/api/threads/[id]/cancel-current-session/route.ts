import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';
import { cancelCurrentSessionForThread } from '../../../../../server/sessions';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const { id } = await ctx.params;
  const result = await cancelCurrentSessionForThread(id);
  if (!result.ok) {
    return err(result.error, result.error === 'thread_not_found' ? 404 : 409);
  }
  return ok({ session_id: result.session_id });
}
