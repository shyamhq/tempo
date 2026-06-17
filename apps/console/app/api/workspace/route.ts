import { clerkClient } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFromRequest } from '../../../server/actor';
import { err, ok, parseBody } from '../../../server/http';

// Workspace identity + name live in Clerk's Organization and are read on the
// client via `useOrganization()` / `useOrganizationList()`. This file owns
// the admin-only mutations that go through the Clerk Backend SDK.

const PatchInput = z.object({ name: z.string().trim().min(1).max(80) });

export async function PATCH(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const parsed = await parseBody(req, PatchInput);
  if (!parsed.ok) return parsed.response;
  const client = await clerkClient();
  await client.organizations.updateOrganization(auth.org_id, { name: parsed.data.name });
  return ok({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const client = await clerkClient();
  await client.organizations.deleteOrganization(auth.org_id);
  return ok({ ok: true });
}
