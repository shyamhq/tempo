import { CreateReplyRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { postReply } from '../../../../../server/replies';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const parsed = await parseBody(req, CreateReplyRequest);
  if (!parsed.ok) return parsed.response;
  try {
    const reply = await postReply(id, parsed.data.payload, auth.actor);
    return ok(reply, 201);
  } catch (e) {
    if ((e as Error).message === 'comment_not_found') return err('comment_not_found', 404);
    throw e;
  }
}
