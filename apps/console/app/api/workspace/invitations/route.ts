import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { env } from '../../../../env';
import { authFromRequest } from '../../../../server/actor';
import { err, ok, parseBody } from '../../../../server/http';
import { inviteMember, listInvitations } from '../../../../server/workspaces';

const InvitationInput = z.object({
  email: z.string().email().max(254),
  role: z.enum(['admin', 'member']),
});

export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const list = await listInvitations(auth.org_id);
  return ok({
    invitations: list.data.map((i) => ({
      id: i.id,
      email: i.emailAddress,
      role: i.role,
      status: i.status,
      created_at: i.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const parsed = await parseBody(req, InvitationInput);
  if (!parsed.ok) return parsed.response;
  const invitation = await inviteMember(
    auth.org_id,
    auth.user_id,
    parsed.data.email,
    parsed.data.role,
    `${env.CONSOLE_URL}/accept-invite`,
  );
  return ok({ invitation: { id: invitation.id, email: invitation.emailAddress } }, 201);
}
