import { getHostedState, threadBelongsToWorkspace } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../../server/actor';
import { err, ok } from '../../../../../../server/http';

// Read-only — any workspace member can poll. Returns the workspace's
// hosted_enabled flag + the live VM metadata (or null if no Sandbox alive).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('forbidden', 403);
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('not_found', 404);
  return ok(await getHostedState(id));
}
