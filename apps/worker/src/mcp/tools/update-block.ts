import { UpdateBlockInput } from '@tempo/contracts/mcp';
import { NotFoundError, ValidationError } from '@tempo/errors';
import { updateBlock } from '@tempo/server';

import { threadIdRequired } from './_shared';

export function registerUpdateBlock(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_update_block',
    "Replace one block's content. The block id is preserved; surrounding blocks and their anchored Comments are untouched. Use $-suffixed IDs from tempo_pull_plan.",
    UpdateBlockInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return threadIdRequired();
      try {
        await updateBlock(threadId, args.block_id, args.html, 'agent');
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
