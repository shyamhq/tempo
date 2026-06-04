import { CreateThreadRequest, ListThreadsQuery } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { defaultWorkspaceId } from '../../../db/ids';
import { err, ok, parseBody } from '../../../server/http';
import { createThread, listThreads } from '../../../server/threads';

export async function GET(req: NextRequest) {
  const parsed = ListThreadsQuery.safeParse({
    space_id: req.nextUrl.searchParams.get('space_id') ?? undefined,
  });
  if (!parsed.success) return err('invalid_input', 400);
  const rows = await listThreads(defaultWorkspaceId, parsed.data.space_id);
  return ok({ threads: rows });
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, CreateThreadRequest);
  if (!parsed.ok) return parsed.response;
  const { thread, connect_token } = await createThread(
    defaultWorkspaceId,
    parsed.data.space_id,
    parsed.data.title,
    parsed.data.description,
  );
  return ok({ thread, connect_token }, 201);
}
