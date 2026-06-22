import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok, toResponse } from '../../../../server/http';
import { maskedAgentKey } from '../../../../server/workspaces';

// GET /api/workspace/agent-key — the masked agent key for the active workspace.
// Admin-only: the key is the workspace's CLI Bearer secret, so members never
// see even its masked form. Hits OUR DB (not Clerk), so a server route is the
// correct path here (vs. member/org data, which the UI reads from Clerk hooks).
export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  try {
    const masked = await maskedAgentKey(auth.workspace_id);
    if (masked === null) return err('not_found', 404);
    return ok({ agent_api_key: masked });
  } catch (e) {
    return toResponse(e);
  }
}
