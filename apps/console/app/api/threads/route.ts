import { CreateThreadRequest, ListThreadsQuery } from '@tempo/contracts/http';
import { createThread, listThreads } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../server/actor';
import { err, ok, parseBody, toResponse } from '../../../server/http';
import { listSpaces } from '../../../server/spaces';

// GET/listThreads back the home's richer thread list (presence + updated_at),
// the immediate next task — distinct from the sidebar's lighter /api/spaces tree.
export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const parsed = ListThreadsQuery.safeParse({
    space_id: req.nextUrl.searchParams.get('space_id') ?? undefined,
  });
  if (!parsed.success) return err('invalid_input', 400);
  try {
    const threads = await listThreads(auth.workspace_id, parsed.data.space_id);
    return ok({ threads });
  } catch (e) {
    return toResponse(e);
  }
}

// Dev-only; the Agent never creates Threads.
export async function POST(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const parsed = await parseBody(req, CreateThreadRequest);
  if (!parsed.ok) return parsed.response;
  try {
    // The client supplies space_id; confirm it belongs to the caller's workspace
    // so a forged id can't file a Thread into a Space the Dev doesn't own.
    const spaces = await listSpaces(auth.workspace_id);
    if (!spaces.some((s) => s.id === parsed.data.space_id)) return err('space_not_found', 404);
    const { thread, connect_token } = await createThread(
      auth.workspace_id,
      parsed.data.space_id,
      parsed.data.title,
      parsed.data.description,
      parsed.data.agent_type,
      parsed.data.repos,
    );
    return ok({ thread, connect_token }, 201);
  } catch (e) {
    return toResponse(e);
  }
}
