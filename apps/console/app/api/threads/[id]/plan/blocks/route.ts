import { AddBlocksInput } from '@tempo/contracts/mcp';
import type { NextRequest } from 'next/server';
import { authFromRequest, authorOf } from '../../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../../server/http';
import {
  addBlocks,
  BlockNotFoundError,
  getPlanBlocks,
  InvalidPlanBodyError,
} from '../../../../../../server/plan';
import { threadBelongsToWorkspace } from '../../../../../../server/threads';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && !(await threadBelongsToWorkspace(id, auth.workspace_id)))
    return err('unauthorized', 401);
  return ok(await getPlanBlocks(id));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  if (auth.actor === 'agent' && !(await threadBelongsToWorkspace(id, auth.workspace_id)))
    return err('unauthorized', 401);
  const parsed = await parseBody(req, AddBlocksInput);
  if (!parsed.ok) return parsed.response;
  const { reference_id, position, blocks } = parsed.data;
  try {
    const result = await addBlocks(id, reference_id, position, blocks, authorOf(auth));
    return ok({ ok: true, ids: result.ids });
  } catch (e) {
    if (e instanceof BlockNotFoundError) return err('not_found', 404);
    if (e instanceof InvalidPlanBodyError) return err('invalid_body', 400, e.message);
    throw e;
  }
}
