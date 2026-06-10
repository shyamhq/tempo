import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../server/http';
import { LastAdminError, removeMember, updateMemberRole } from '../../../../../server/workspaces';

const PatchInput = z.object({ role: z.enum(['admin', 'member']) });

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const { userId } = await ctx.params;
  // Self-removal is allowed for everyone (subject to last-admin guard).
  // Removing someone else requires admin.
  if (userId !== auth.user_id && auth.role !== 'admin') return err('forbidden', 403);
  try {
    await removeMember(auth.org_id, userId);
  } catch (e) {
    if (e instanceof LastAdminError) return err('last_admin', 409);
    throw e;
  }
  return ok({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const parsed = await parseBody(req, PatchInput);
  if (!parsed.ok) return parsed.response;
  const { userId } = await ctx.params;
  try {
    await updateMemberRole(auth.org_id, userId, parsed.data.role);
  } catch (e) {
    if (e instanceof LastAdminError) return err('last_admin', 409);
    throw e;
  }
  return ok({ ok: true });
}
