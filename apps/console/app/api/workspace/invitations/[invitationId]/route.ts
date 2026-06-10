import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';
import { revokeInvitation } from '../../../../../server/workspaces';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ invitationId: string }> },
) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const { invitationId } = await ctx.params;
  await revokeInvitation(auth.org_id, invitationId, auth.user_id);
  return ok({ ok: true });
}
