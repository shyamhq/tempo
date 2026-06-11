import type { WebhookEvent } from '@clerk/nextjs/server';
import { clerkClient } from '@clerk/nextjs/server';
import { logger } from '../logger';
import { getOrCreateWorkspaceForOrg, renameWorkspaceForOrg } from './workspaces';

// Notion method: every new Clerk user gets a personal Organization auto-created
// on first sign-up. The Organization webhook then mirrors it to a `workspaces`
// row. Handlers are idempotent — Clerk retries on non-2xx, and webhook order
// vs. user session is racy (actor.ts lazy-upserts as a safety net).
export async function handleClerkEvent(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case 'user.created': {
      const userId = event.data.id;
      const firstName = event.data.first_name;
      const orgName = firstName ? `${firstName}'s Workspace` : 'My Workspace';
      const client = await clerkClient();
      await client.organizations.createOrganization({
        name: orgName,
        createdBy: userId,
      });
      logger.info({ userId, orgName }, 'clerk-webhook: created personal org');
      return;
    }
    case 'organization.created': {
      const orgId = event.data.id;
      const orgName = event.data.name;
      const ws = await getOrCreateWorkspaceForOrg(orgId, orgName);
      logger.info({ orgId, workspaceId: ws.id }, 'clerk-webhook: workspace mirrored');
      return;
    }
    case 'organization.updated': {
      await renameWorkspaceForOrg(event.data.id, event.data.name);
      return;
    }
    default:
      // Other events arrive only if subscribed in the Clerk dashboard; ignore.
      return;
  }
}
