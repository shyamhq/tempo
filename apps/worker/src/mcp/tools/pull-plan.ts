import { PullPlanInput } from '@tempo/contracts/mcp';
import { getPlanBlocks } from '@tempo/server';

import { threadIdRequired } from './_shared';

export function registerPullPlan(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_pull_plan',
    'Fetch the current plan as a flat list of blocks with HTML content, keyed by opaque $-suffixed block IDs. Pull before each edit batch to get fresh block IDs.',
    PullPlanInput.shape,
    async (_args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return threadIdRequired();
      const result = await getPlanBlocks(threadId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
