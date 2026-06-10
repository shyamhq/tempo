import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok } from '../../../../server/http';
import { listMembers } from '../../../../server/workspaces';

export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('unauthorized', 401);
  const list = await listMembers(auth.org_id);
  return ok({
    members: list.data.map((m) => ({
      user_id: m.publicUserData?.userId ?? null,
      email: m.publicUserData?.identifier ?? null,
      first_name: m.publicUserData?.firstName ?? null,
      last_name: m.publicUserData?.lastName ?? null,
      image_url: m.publicUserData?.imageUrl ?? null,
      role: m.role,
      created_at: m.createdAt,
    })),
  });
}
