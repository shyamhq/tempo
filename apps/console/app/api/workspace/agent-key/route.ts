import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok } from '../../../../server/http';
import { maskedAgentKey } from '../../../../server/workspaces';

export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const masked = await maskedAgentKey(auth.workspace_id);
  if (!masked) return err('workspace_not_found', 404);
  return ok({ agent_api_key: masked });
}
