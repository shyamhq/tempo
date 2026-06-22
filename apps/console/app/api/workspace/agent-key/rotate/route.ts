import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, toResponse } from '../../../../../server/http';
import { rotateAgentKey } from '../../../../../server/workspaces';

// POST /api/workspace/agent-key/rotate — mints a fresh key and returns the full
// value ONCE (the only time the secret crosses the wire). Admin-only; rotation
// invalidates any CLI session on the old key.
export async function POST(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  try {
    const next = await rotateAgentKey(auth.workspace_id);
    return ok({ agent_api_key: next });
  } catch (e) {
    return toResponse(e);
  }
}
