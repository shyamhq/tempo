import { auth as clerkAuth, clerkClient } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '../db';
import { sessions, threads } from '../db/schema';
import { getOrCreateWorkspaceForOrg } from './workspaces';

// Auth contract:
//  - Bearer <connect_token> → agent. Plaintext compare against threads.connect_token.
//    Phase 4b introduces `sk_agent_…` workspace keys and demotes the connect-token
//    to handshake-only on POST /api/sessions.
//  - Clerk session (cookie) → user. Resolved via auth() from @clerk/nextjs.
//    workspace_id resolves from the active Clerk Org via getOrCreateWorkspaceForOrg
//    (lazy upsert if the webhook hasn't landed yet).
export type AuthContext =
  | { actor: 'agent'; workspace_id: string; thread_id: string; session_id: string | null }
  | { actor: 'user'; user_id: string; workspace_id: string; role: 'admin' | 'member' }
  | null;

export async function authFromRequest(req: NextRequest): Promise<AuthContext> {
  const bearer = readBearer(req);
  if (bearer) return resolveAgent(bearer);
  return resolveUser();
}

async function resolveAgent(token: string): Promise<AuthContext> {
  const [t] = await db
    .select({ id: threads.id, workspace_id: threads.workspace_id })
    .from(threads)
    .where(eq(threads.connect_token, token))
    .limit(1);
  if (!t) return null;
  // Most-recent session for the Thread — Threads accumulate one row per
  // `tempo-agent connect` call; the running Agent always has the newest
  // session_id in its env.
  const [s] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.thread_id, t.id))
    .orderBy(desc(sessions.created_at))
    .limit(1);
  return {
    actor: 'agent',
    workspace_id: t.workspace_id,
    thread_id: t.id,
    session_id: s?.id ?? null,
  };
}

async function resolveUser(): Promise<AuthContext> {
  const { userId, orgId, orgRole } = await clerkAuth();
  if (!userId) return null;
  // No active Org → user is signed in but hasn't selected one yet. The Notion
  // method auto-creates a personal Org via webhook on user.created; the lag
  // between sign-up and first request is covered by lazy upsert below.
  if (!orgId) return null;
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });
  const ws = await getOrCreateWorkspaceForOrg(orgId, org.name);
  const role: 'admin' | 'member' = orgRole === 'org:member' ? 'member' : 'admin';
  return { actor: 'user', user_id: userId, workspace_id: ws.id, role };
}

// Map an auth context to the `author`/`updated_by` enum currently stored on
// `replies`, `discussion_messages`, and `plans`. The DB enum is still
// `'dev' | 'agent'`; Phase 5 widens `plans.updated_by` to carry a Clerk
// user id, at which point this helper expands.
export function authorOf(auth: NonNullable<AuthContext>): 'dev' | 'agent' {
  return auth.actor === 'agent' ? 'agent' : 'dev';
}

function readBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/.exec(header);
  return m ? m[1]! : null;
}
