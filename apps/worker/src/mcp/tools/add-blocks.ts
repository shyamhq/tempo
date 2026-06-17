import { AddBlocksInput } from '@tempo/contracts/mcp';
import { NotFoundError, ValidationError } from '@tempo/errors';
import { addBlocks } from '@tempo/server';

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
        if (err instanceof NotFoundError) {
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
        if (err instanceof ValidationError) {
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
