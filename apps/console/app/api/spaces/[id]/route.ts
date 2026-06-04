import { UpdateSpaceRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok, parseBody } from '../../../../server/http';
import { deleteSpace, updateSpace } from '../../../../server/spaces';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'dev') return err('unauthorized', 401);
  const parsed = await parseBody(req, UpdateSpaceRequest);
  if (!parsed.ok) return parsed.response;
  const { id } = await ctx.params;
  try {
    await updateSpace(id, parsed.data);
    return ok({ ok: true });
  } catch (e) {
    if ((e as Error).message === 'space_not_found') return err('space_not_found', 404);
    throw e;
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'dev') return err('unauthorized', 401);
  const { id } = await ctx.params;
  try {
    await deleteSpace(id);
  } catch (e) {
    if ((e as Error).message === 'space_not_found') return err('space_not_found', 404);
    throw e;
  }
  return ok({ ok: true });
}
