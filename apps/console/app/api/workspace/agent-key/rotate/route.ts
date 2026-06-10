import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';
import { rotateAgentKey } from '../../../../../server/workspaces';

export async function POST(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  // The returned key is the one and only time the full value is exposed —
  // active CLI sessions for this workspace are now invalidated and need a
  // fresh `tempo-agent connect <token>` handshake.
  const key = await rotateAgentKey(auth.workspace_id);
  return ok({ agent_api_key: key });
}
