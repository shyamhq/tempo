import { getConnectToken } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const { id } = await ctx.params;
  try {
    return ok(await getConnectToken(id));
  } catch (e) {
    if ((e as Error).message === 'thread_not_found') return err('thread_not_found', 404);
    throw e;
  }
}
