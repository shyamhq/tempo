import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListIntegrationActionsInput } from '@tempo/contracts/mcp';
import { listReadActions } from '@tempo/server';
import type { Caller } from '../../auth';
import { resolveThreadWorkspace, runConnectorCall } from '../../gateway';
import { threadIdRequired } from './_shared';

export function registerListIntegrationActions(
  server: McpServer,
  caller: Caller,
  headerThreadId: string | undefined,
): void {
  server.tool(
    'tempo_list_integration_actions',
    "List the READ-ONLY actions available on a tier-2 Pipedream-connected app (linear, jira, sentry, notion, slack, vercel, figma). Returns each action's exact `key` (pass it as `action` to tempo_use_integration), its name/description, and the `props` to put in `params`. Call this before tempo_use_integration so you use real action keys instead of guessing.",
    ListIntegrationActionsInput.shape,
    async (args) => {
      const ctx = await resolveThreadWorkspace(caller, headerThreadId);
      if (!ctx) return threadIdRequired();
      return runConnectorCall(
        ctx,
        { connectorId: args.app, toolName: 'tempo_list_integration_actions', request: args },
        () => listReadActions(args.app),
      );
    },
  );
}
