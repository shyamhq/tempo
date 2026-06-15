import { PollInput } from '@tempo/contracts/mcp';
import { getThreadIdForMcpSession } from '../../server/auth-lookup';
import { longPoll } from '../../server/events-stream';

const MAX_WAIT_SECONDS = 25;

export function registerPoll(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  getMcpSessionId: () => string | undefined,
): void {
  server.tool(
    'tempo_poll',
    'Long-poll for new events since your last cursor. Blocks up to 25 seconds and returns immediately when events arrive. Pass the cursor from the last attach or poll response.',
    PollInput.shape,
    async (args) => {
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
      const result = await longPoll(threadId, args.cursor, MAX_WAIT_SECONDS);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
