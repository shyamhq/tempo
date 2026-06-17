import { DeleteBlockInput } from '@tempo/contracts/mcp';
import { NotFoundError } from '@tempo/errors';
import { deleteBlock } from '@tempo/server';

import { threadIdRequired } from './_shared';

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
      if (!threadId) return threadIdRequired();
      try {
        await deleteBlock(threadId, args.block_id, 'agent');
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      } catch (err) {
        if (err instanceof NotFoundError) {
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
