import { UpdatePlanInput } from '@tempo/contracts/mcp';
import { InvalidPlanBodyError, PlanNotEmptyError, updatePlan } from '@tempo/server';
import { getThreadIdForMcpSession } from '../../server/auth-lookup';

export function registerUpdatePlan(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  getMcpSessionId: () => string | undefined,
): void {
  server.tool(
    'tempo_update_plan',
    'Write the first draft of a Plan from a single HTML document. Legal only when the Plan is empty (no body yet). For subsequent edits use tempo_update_block / tempo_add_blocks / tempo_delete_block so anchored Comments survive.',
    UpdatePlanInput.shape,
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
        const result = await updatePlan(threadId, args.html, 'agent');
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ids: result.ids }) }] };
      } catch (err) {
        if (err instanceof PlanNotEmptyError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'plan_not_empty', message: err.message }),
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
