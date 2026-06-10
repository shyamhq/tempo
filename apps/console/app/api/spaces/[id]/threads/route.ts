import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';
import { listSpaceThreadsLite } from '../../../../../server/spaces';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const { id } = await params;
  const threads = await listSpaceThreadsLite(id);
  return ok({ threads });
}
