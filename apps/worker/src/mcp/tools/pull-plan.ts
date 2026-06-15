import { PullPlanInput } from '@tempo/contracts/mcp';
import { getThreadIdForMcpSession } from '../../server/auth-lookup';
import { getPlanBlocks } from '../../server/plan';

export function registerPullPlan(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  getMcpSessionId: () => string | undefined,
): void {
  server.tool(
    'tempo_pull_plan',
    'Fetch the current plan as a flat list of blocks with HTML content, keyed by opaque $-suffixed block IDs. Pull before each edit batch to get fresh block IDs.',
    PullPlanInput.shape,
    async (_args) => {
      const mcpSessionId = getMcpSessionId();
      if (!mcpSessionId) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'session_not_found',
                message: 'call tempo_attach before this tool',
              }),
            },
          ],
        };
      }
      const threadId = await getThreadIdForMcpSession(mcpSessionId);
      if (!threadId) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'session_not_found',
                message: 'you must call tempo_attach before this tool',
              }),
            },
          ],
        };
      }
      const result = await getPlanBlocks(threadId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
