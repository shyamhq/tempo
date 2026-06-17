import { createHash } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { db } from '@tempo/db/client';
import { threads, userTokens, workspaces } from '@tempo/db/schema';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { env } from '../env';

// Module-level Clerk client — JWKS cache is reused across requests.
const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

// SHA-256 + pepper so the DB never holds a usable plaintext token.
// The pepper is distinct from a salt: it's a server-side secret that means a
// stolen DB dump cannot be brute-forced without also compromising the env var.
export function hashToken(plaintext: string): string {
  return createHash('sha256')
    .update(plaintext + env.TOKEN_HASH_PEPPER)
    .digest('hex');
}

// Resolves a workspace-scoped agent API key to its workspace row.
// Used by the existing sk_agent_* bearer branch.
export async function lookupWorkspaceByAgentKey(token: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.agent_api_key, token))
    .limit(1);
  return row ?? null;
}

// Resolves a CLI user token (sk_user_*) to its owning Clerk user id.
// Filters out revoked and expired tokens at the DB level.
export async function lookupUserByToken(plaintext: string): Promise<{ user_id: string } | null> {
  const hash = hashToken(plaintext);
  const [row] = await db
    .select({ user_id: userTokens.user_id })
    .from(userTokens)
    .where(
      and(
        eq(userTokens.token_hash, hash),
        isNull(userTokens.revoked_at),
        gt(userTokens.expires_at, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export class NotAMemberError extends Error {
  constructor(userId: string, threadId: string) {
    super(`user ${userId} is not a member of the workspace owning thread ${threadId}`);
    this.name = 'NotAMemberError';
  }
}

export class ThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`thread ${threadId} not found`);
    this.name = 'ThreadNotFoundError';
  }
}

// Verifies that a Clerk user is a member of the workspace owning the given
// thread, and returns the resolved workspaceId and the Clerk membershipId.
//
// Path chosen: direct DB lookup against the `workspaces` table via
// `threads.workspace_id → workspaces.clerk_org_id`, then Clerk SDK
// `organizations.getOrganizationMembershipList` to verify membership.
// Rationale: there is no `members` table in the current schema. Using Clerk
// SDK as source of truth is correct for slice 1c-1; if a `members` table is
// added later (via webhooks), this becomes a one-query DB lookup.
export async function assertMembership(
  userId: string,
  threadId: string,
): Promise<{ workspaceId: string; memberId: string }> {
  const [threadRow] = await db
    .select({ workspace_id: threads.workspace_id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!threadRow) throw new ThreadNotFoundError(threadId);

  const [wsRow] = await db
    .select({ id: workspaces.id, clerk_org_id: workspaces.clerk_org_id })
    .from(workspaces)
    .where(eq(workspaces.id, threadRow.workspace_id))
    .limit(1);
  if (!wsRow) throw new NotAMemberError(userId, threadId);

  const memberships = await clerk.organizations.getOrganizationMembershipList({
    organizationId: wsRow.clerk_org_id,
  });

  const match = memberships.data.find(
    (m: { id: string; publicUserData?: { userId?: string } | null }) =>
      m.publicUserData?.userId === userId,
  );
  if (!match) throw new NotAMemberError(userId, threadId);

  return { workspaceId: wsRow.id, memberId: match.id };
}

// Caller-aware threadId resolution + authorization. Hosted callers carry the
// threadId in their JWT; CLI / browser callers pass it on `X-Tempo-Thread-Id`.
// Runs `authorizeThread` so a forged header can't unlock cross-workspace access.
// On success, fires the presence bump (`agent_last_seen_at`) since this is the
// single per-tool entry point that has both the authorized threadId and the
// signal that the Agent just touched us. Returns null on missing/forbidden,
// which tools surface as `thread_id_required`.
export async function resolveThreadIdForCaller(
  caller: import('../auth').Caller,
  headerThreadId: string | undefined,
): Promise<string | null> {
  const candidate = caller.kind === 'hosted' ? caller.threadId : (headerThreadId ?? null);
  if (!candidate) return null;
  try {
    const { authorizeThread } = await import('../auth');
    await authorizeThread(caller, candidate);
  } catch {
    return null;
  }
  const { bumpAgentLastSeen } = await import('@tempo/server');
  void bumpAgentLastSeen(candidate).catch(() => {});
  return candidate;
}
