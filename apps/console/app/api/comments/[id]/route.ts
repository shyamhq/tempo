import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { CommentNotFoundError, deleteComment } from '../../../../server/comments';
import { err, ok } from '../../../../server/http';

// Dev-only delete. The Agent never gets a delete-comment tool — comments are
// the Dev's surface for asking the Agent to change something, and the Agent
// shouldn't be able to silence those requests by deleting them.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth || auth.actor !== 'dev') return err('unauthorized', 401);
  try {
    await deleteComment(id);
  } catch (e) {
    if (e instanceof CommentNotFoundError) return err('not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}
