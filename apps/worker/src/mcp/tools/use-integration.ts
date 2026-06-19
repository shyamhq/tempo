import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UseIntegrationInput } from '@tempo/contracts/mcp';
import { dispatchIntegration } from '@tempo/server';
import type { Caller } from '../../auth';
import { assertReadOnlyAction, resolveThreadWorkspace, runConnectorCall } from '../../gateway';
import { threadIdRequired } from './_shared';

export function registerUseIntegration(
  server: McpServer,
  caller: Caller,
  headerThreadId: string | undefined,
): void {
  server.tool(
    'tempo_use_integration',
    'Run a READ-ONLY action on a tier-2 Pipedream-connected app (linear, jira, sentry, notion, slack, vercel, figma). GitHub is NOT here — it has dedicated tempo_github_* tools. First call tempo_list_integration_actions to get the valid `action` keys and their props; pass the exact key as `action` and its props as `params` (e.g. {query:"auth bug"}). Only read actions are permitted; writes and unknown keys are rejected.',
    UseIntegrationInput.shape,
    async (args) => {
      const ctx = await resolveThreadWorkspace(caller, headerThreadId);
      if (!ctx) return threadIdRequired();
      return runConnectorCall(
        ctx,
        { connectorId: args.app, toolName: 'tempo_use_integration', request: args },
        async ({ workspaceId }) => {
          // Read-only governance: the action must be a known read in Pipedream's
          // catalog (readOnlyHint); writes and unknown keys are rejected here,
          // before anything reaches Pipedream.
          await assertReadOnlyAction(args.app, args.action);
          return dispatchIntegration(workspaceId, args.app, args.action, args.params);
        },
      );
    },
  );
}
