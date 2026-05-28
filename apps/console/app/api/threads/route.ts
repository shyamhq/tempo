import { CreateThreadRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { defaultWorkspaceId } from '../../../db/ids';
import { ok, parseBody } from '../../../server/http';
import { createThread, listThreads } from '../../../server/threads';

export async function GET() {
  const rows = await listThreads();
  return ok({ threads: rows });
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, CreateThreadRequest);
  if (!parsed.ok) return parsed.response;
  const { thread, connect_token } = await createThread(
    defaultWorkspaceId,
    parsed.data.title,
    parsed.data.description,
  );
  return ok({ thread, connect_token }, 201);
}
