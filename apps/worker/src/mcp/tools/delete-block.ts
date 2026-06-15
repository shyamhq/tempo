import { DeleteBlockInput } from '@tempo/contracts/mcp';
import { BlockNotFoundError, deleteBlock } from '@tempo/server';
import { getThreadIdForMcpSession } from '../../server/auth-lookup';

export function registerDeleteBlock(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  getMcpSessionId: () => string | undefined,
): void {
  server.tool(
    'tempo_delete_block',
    'Remove a block from the Plan. Keeps the document non-empty by inserting an empty paragraph when the last block is deleted.',
    DeleteBlockInput.shape,
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
      try {
        await deleteBlock(threadId, args.block_id, 'agent');
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      } catch (err) {
        if (err instanceof BlockNotFoundError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'invalid_input',
                  message: `block not found: ${args.block_id}`,
                }),
              },
            ],
          };
        }
        throw err;
      }
    },
  );
}
