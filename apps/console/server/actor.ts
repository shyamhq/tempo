import { auth as clerkAuth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@tempo/db/client';
import { workspaces } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { getOrCreateWorkspaceForOrg } from './workspaces';

// Auth contract:
//  - Bearer sk_agent_…  → agent. Workspace-scoped key minted on workspace
//    creation; the CLI gets it from the POST /api/sessions handshake. Lookup
//    is one indexed query on workspaces.agent_api_key.
//  - Bearer tmp_…       → rejected here. The connect-token is valid only on
//    POST /api/sessions, where the route hand-rolls its own Bearer parse.
//  - Clerk session      → user. workspace_id resolves from the active Clerk
//    Org via getOrCreateWorkspaceForOrg (lazy upsert if the webhook hasn't
//    landed yet).
//
// session_id and thread_id are NOT carried on the agent auth ctx anymore.
// Routes that need session_id read X-Tempo-Session; routes that need
// thread_id read URL params and check workspace membership.
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
  // as member, including unknown / undefined orgRole values. Flipping this to
  // default-grant would let a stale session token escalate.
  const role: 'admin' | 'member' = orgRole === 'org:admin' ? 'admin' : 'member';
  return { actor: 'user', user_id: userId, workspace_id: ws.id, org_id: orgId, role };
}

// Read X-Tempo-Session: agent requests carry the session id here (the CLI
// sets it on every request after handshake). Returns null when missing.
export function readSessionHeader(req: NextRequest): string | null {
  return req.headers.get('x-tempo-session');
}

// RSC helper — pages call this to resolve the current Clerk Org's workspace
// id without going through a Request. Throws if signed out or no active Org;
// the Clerk middleware (proxy.ts) protects every UI page so neither should
// happen in practice.
export async function currentWorkspaceId(): Promise<string> {
  const { userId, orgId } = await clerkAuth();
  if (!userId) throw new Error('unauthenticated');
  if (!orgId) throw new Error('no_active_org');
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });
  const ws = await getOrCreateWorkspaceForOrg(orgId, org.name);
  return ws.id;
}


function readBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/.exec(header);
  return m ? m[1]! : null;
}
