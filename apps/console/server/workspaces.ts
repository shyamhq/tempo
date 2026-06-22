import { randomBytes } from 'node:crypto';
import { db } from '@tempo/db/client';
import { spaces, workspaces } from '@tempo/db/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

// `sk_agent_<random>` — workspace-scoped Bearer token the CLI uses for every
// request after handshake. Rotation invalidates active CLI sessions.
function mintAgentKey(): string {
  return `sk_agent_${randomBytes(32).toString('base64url')}`;
}

export async function getOrCreateWorkspaceForOrg(
  clerkOrgId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  // The agent key is minted on insert but never returned here: resolveUser (the
  // sole caller) needs only the id, and selecting the secret on every
  // authenticated request would put it on the auth hot path for nothing.
  // maskedAgentKey/rotateAgentKey query it independently when the UI asks.
  //
  // ON CONFLICT path keeps the column-add idempotent under the lazy/webhook
  // race: RETURNING fires only on insert, so the second statement re-reads when
  // the row already existed.
  const inserted = await db
    .insert(workspaces)
    .values({
      id: `wsp_${ulid()}`,
      name,
      clerk_org_id: clerkOrgId,
      agent_api_key: mintAgentKey(),
    })
    .onConflictDoNothing({ target: workspaces.clerk_org_id })
    .returning({
      id: workspaces.id,
      name: workspaces.name,
    });
  if (inserted[0]) {
    // Fresh workspace gets the default Space so new threads have a home.
    await db
      .insert(spaces)
      .values({ id: `spc_${ulid()}`, workspace_id: inserted[0].id, name: 'General' })
      .onConflictDoNothing();
    return inserted[0];
  }
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
    })
    .from(workspaces)
    .where(eq(workspaces.clerk_org_id, clerkOrgId))
    .limit(1);
  if (!row) throw new Error(`workspace race lost for clerk_org_id=${clerkOrgId}`);
  return row;
}

// The agent key, masked to its `sk_agent_` prefix + last 4 chars — what the
// settings UI displays at rest (the full secret is only ever revealed once, on
// rotation). Null when the workspace doesn't exist.
export async function maskedAgentKey(workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ agent_api_key: workspaces.agent_api_key })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) return null;
  return maskKey(row.agent_api_key);
}

// Mints a fresh key, persists it, and returns the full value once. Rotation
// invalidates any active CLI session bound to the old key.
export async function rotateAgentKey(workspaceId: string): Promise<string> {
  const next = mintAgentKey();
  const updated = await db
    .update(workspaces)
    .set({ agent_api_key: next })
    .where(eq(workspaces.id, workspaceId))
    .returning({ id: workspaces.id });
  if (!updated[0]) throw new Error(`workspace not found: ${workspaceId}`);
  return next;
}

function maskKey(key: string): string {
  return `sk_agent_…${key.slice(-4)}`;
}
