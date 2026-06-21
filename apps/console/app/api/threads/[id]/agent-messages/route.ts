import { validateTempoMessages } from '@tempo/contracts/agent-message';
import { listAgentMessages, threadBelongsToWorkspace } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (!auth) return err('unauthorized', 401);
  const { id } = await ctx.params;
  if (!(await threadBelongsToWorkspace(id, auth.workspace_id))) return err('forbidden', 403);
  const raw = await listAgentMessages(id);
  // validateUIMessages is all-or-nothing; one schema-drifted row shouldn't blank
  // the whole panel. The rows were written by our own finalizeTurn, so the raw
  // fallback is safe — the renderer's switch tolerates unknown part types.
  const messages = await validateTempoMessages(raw).catch(() => raw);
  return ok({ messages });
}
