import { UpdatePlanInput } from '@tempo/contracts/mcp';
import { ConflictError, ValidationError } from '@tempo/errors';
import { updatePlan } from '@tempo/server';

import { threadIdRequired } from './_shared';

export function registerUpdatePlan(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_update_plan',
    'Write the first draft of a Plan from a single HTML document. Legal only when the Plan is empty (no body yet). For subsequent edits use tempo_update_block / tempo_add_blocks / tempo_delete_block so anchored Comments survive.',
    UpdatePlanInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return threadIdRequired();
      try {
        // Agent is always null updated_by_user_id.
        const result = await updatePlan(threadId, args.html, null);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ids: result.ids }) }] };
      } catch (err) {
        if (err instanceof ConflictError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'plan_not_empty', message: err.message }),
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
