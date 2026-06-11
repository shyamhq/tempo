import { CreateDiscussionMessageRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest, authorOf } from '../../../../../../server/actor';
import { postMessage } from '../../../../../../server/discussion';
import { err, ok, parseBody } from '../../../../../../server/http';
import { threadBelongsToWorkspace } from '../../../../../../server/threads';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);

  const { id } = await ctx.params;
  if (auth.actor === 'agent' && !(await threadBelongsToWorkspace(id, auth.workspace_id))) {
    return err('forbidden', 403);
  }

  const parsed = await parseBody(req, CreateDiscussionMessageRequest);
  if (!parsed.ok) return parsed.response;

  try {
    const message = await postMessage(id, authorOf(auth), parsed.data);
    return ok(message, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'thread_not_found') return err('thread_not_found', 404);
    if (msg === 'thread_approved') return err(msg, 409);
    if (msg === 'invalid_input') return err(msg, 400);
    throw e;
  }
}
