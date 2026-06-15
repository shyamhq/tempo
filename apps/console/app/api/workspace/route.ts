import { clerkClient } from '@clerk/nextjs/server';
import { db } from '@tempo/db/client';
import { workspaces } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFromRequest } from '../../../server/actor';
import { err, ok, parseBody } from '../../../server/http';

// Workspace identity + name live in Clerk's Organization and are read on the
// client via `useOrganization()` / `useOrganizationList()`. This file owns
// the admin-only mutations that go through the Clerk Backend SDK and the
// Tempo-local Workspace flags (hosted_enabled etc.).

// One or the other, not both — Clerk owns `name` and our DB owns
// `hosted_enabled`; mixing them in a single PATCH risks a partial commit
// where Clerk renamed but the flag write failed (or vice versa). The
// discriminated union makes the bad shape unrepresentable.
const PatchInput = z.union([
  z.object({ name: z.string().trim().min(1).max(80) }),
  z.object({ hosted_enabled: z.boolean() }),
]);

export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const [row] = await db
    .select({ hosted_enabled: workspaces.hosted_enabled })
    .from(workspaces)
    .where(eq(workspaces.id, auth.workspace_id))
    .limit(1);
  return ok({ hosted_enabled: row?.hosted_enabled ?? false });
}

export async function PATCH(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const parsed = await parseBody(req, PatchInput);
  if (!parsed.ok) return parsed.response;
  if ('name' in parsed.data) {
    const client = await clerkClient();
    await client.organizations.updateOrganization(auth.org_id, { name: parsed.data.name });
  } else {
    await db
      .update(workspaces)
      .set({ hosted_enabled: parsed.data.hosted_enabled })
      .where(eq(workspaces.id, auth.workspace_id));
  }
  return ok({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);
  const client = await clerkClient();
  await client.organizations.deleteOrganization(auth.org_id);
  return ok({ ok: true });
}
