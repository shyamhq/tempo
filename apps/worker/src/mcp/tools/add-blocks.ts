import { AddBlocksInput } from '@tempo/contracts/mcp';
import { addBlocks, BlockNotFoundError, InvalidPlanBodyError } from '@tempo/server';

import { sessionNotFound } from './_shared';

export function registerAddBlocks(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_add_blocks',
    'Insert new blocks relative to an existing block (before/after) or at the document boundary (end). Returns $-suffixed IDs for the newly inserted blocks.',
    AddBlocksInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return sessionNotFound();
      try {
        const result = await addBlocks(
          threadId,
          args.reference_id,
          args.position,
          args.blocks,
          'agent',
        );
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ids: result.ids }) }] };
      } catch (err) {
        if (err instanceof BlockNotFoundError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'invalid_input',
                  message: `reference block not found: ${args.reference_id}`,
                }),
              },
            ],
          };
        }
        if (err instanceof InvalidPlanBodyError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'invalid_input', message: err.message }),
              },
            ],
          };
        }
        throw err;
      }
    },
  );
}
