import { DeleteBlockInput } from '@tempo/contracts/mcp';
import { BlockNotFoundError, deleteBlock } from '@tempo/server';

import { sessionNotFound } from './_shared';

export function registerDeleteBlock(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_delete_block',
    'Remove a block from the Plan. Keeps the document non-empty by inserting an empty paragraph when the last block is deleted.',
    DeleteBlockInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return sessionNotFound();
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
