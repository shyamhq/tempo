import { CreateSpaceRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../server/actor';
import { err, ok, parseBody } from '../../../server/http';
import { createSpace, listSpaces } from '../../../server/spaces';

export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'dev') return err('unauthorized', 401);
  const spaces = await listSpaces();
  return ok({ spaces });
}

export async function POST(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'dev') return err('unauthorized', 401);
  const parsed = await parseBody(req, CreateSpaceRequest);
  if (!parsed.ok) return parsed.response;
  const space = await createSpace(parsed.data.name);
  return ok({ space }, 201);
}
