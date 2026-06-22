import { CreateSpaceRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../server/actor';
import { err, ok, parseBody } from '../../../server/http';
import { createSpace, listSpaceTree } from '../../../server/spaces';

// GET /api/spaces — the full navigation tree (spaces + their threads) in one
// pass. The sidebar seeds its slice once on shell mount from this (no per-space
// lazy load behind a Query cache). The threadsBySpace shape is Console-internal
// hydration data, not a wire shape the Agent exchanges, so it has no frozen
// contract — the sidebar feature api validates it.
export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const tree = await listSpaceTree(auth.workspace_id);
  return ok(tree);
}

export async function POST(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const parsed = await parseBody(req, CreateSpaceRequest);
  if (!parsed.ok) return parsed.response;
  const space = await createSpace(parsed.data.name, auth.workspace_id);
  return ok({ space }, 201);
}
