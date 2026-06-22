import { auth as clerkAuth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@tempo/db/client';
import { workspaces } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { getOrCreateWorkspaceForOrg } from './workspaces';

// Auth contract (mirrors apps/console/server/actor.ts):
//  - Bearer sk_agent_…  → agent. Workspace-scoped key minted on workspace
//    creation; lookup is one indexed query on workspaces.agent_api_key.
//  - Clerk session      → user. workspace_id resolves from the active Clerk
//    Org via getOrCreateWorkspaceForOrg (lazy upsert if the webhook hasn't
//    landed yet).
export type AuthContext =
  | { actor: 'agent'; workspace_id: string }
  | {
      actor: 'user';
      user_id: string;
      workspace_id: string;
      org_id: string;
      role: 'admin' | 'member';
    }
  | null;

export async function authFromRequest(req: NextRequest): Promise<AuthContext> {
  const bearer = readBearer(req);
  if (bearer) return resolveAgent(bearer);
  return resolveUser();
}

async function resolveAgent(token: string): Promise<AuthContext> {
  if (!token.startsWith('sk_agent_')) return null;
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.agent_api_key, token))
    .limit(1);
  if (!row) return null;
  return { actor: 'agent', workspace_id: row.id };
}

async function resolveUser(): Promise<AuthContext> {
  const { userId, orgId, orgRole } = await clerkAuth();
  if (!userId) return null;
  if (!orgId) return null;
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });
  const ws = await getOrCreateWorkspaceForOrg(orgId, org.name);
  // Default-deny: anything Clerk doesn't explicitly mark as admin is treated
  // as member, including unknown / undefined orgRole values.
  const role: 'admin' | 'member' = orgRole === 'org:admin' ? 'admin' : 'member';
  return { actor: 'user', user_id: userId, workspace_id: ws.id, org_id: orgId, role };
}

function readBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  return /^Bearer\s+(\S+)$/.exec(header)?.[1] ?? null;
}
