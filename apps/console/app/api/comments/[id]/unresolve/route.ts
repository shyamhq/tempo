import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { unresolveComment } from '../../../../../server/comments';
import { err, ok } from '../../../../../server/http';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor !== 'user') return err('forbidden', 403, 'only the Dev can unresolve comments');
  try {
    await unresolveComment(id);
  } catch (e) {
    if ((e as Error).message === 'comment_not_found') return err('comment_not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}
