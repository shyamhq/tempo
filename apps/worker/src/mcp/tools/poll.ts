import { PollInput } from '@tempo/contracts/mcp';
import { longPoll } from '@tempo/server';

const MAX_WAIT_SECONDS = 25;

import { sessionNotFound } from './_shared';

export function registerPoll(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_poll',
    'Long-poll for new events since your last cursor. Blocks up to 25 seconds and returns immediately when events arrive. Pass the cursor from the last attach or poll response.',
    PollInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return sessionNotFound();
      const result = await longPoll(threadId, args.cursor, MAX_WAIT_SECONDS);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
