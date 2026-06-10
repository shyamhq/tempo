import { UpdateBlockInput } from '@tempo/contracts/mcp';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../../../server/http';
import {
  BlockNotFoundError,
  deleteBlock,
  InvalidPlanBodyError,
  updateBlock,
} from '../../../../../../../server/plan';

// The route takes `block_id` from the URL path, so the body schema drops it.
const UpdateBlockBody = UpdateBlockInput.pick({ html: true });

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; blockId: string }> },
) {
  const { id, blockId } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && auth.thread_id !== id) return err('unauthorized', 401);
  const parsed = await parseBody(req, UpdateBlockBody);
  if (!parsed.ok) return parsed.response;
  try {
    await updateBlock(id, blockId, parsed.data.html, auth.actor);
  } catch (e) {
    if (e instanceof BlockNotFoundError) return err('not_found', 404);
    if (e instanceof InvalidPlanBodyError) return err('invalid_body', 400, e.message);
    throw e;
  }
  return ok({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; blockId: string }> },
) {
  const { id, blockId } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && auth.thread_id !== id) return err('unauthorized', 401);
  try {
    await deleteBlock(id, blockId, auth.actor);
  } catch (e) {
    if (e instanceof BlockNotFoundError) return err('not_found', 404);
    if (e instanceof InvalidPlanBodyError) return err('invalid_body', 400, e.message);
    throw e;
  }
  return ok({ ok: true });
}
