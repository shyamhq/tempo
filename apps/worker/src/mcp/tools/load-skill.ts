import { z } from 'zod';
import { getThreadIdForMcpSession } from '../../server/auth-lookup';
import { listSkills, loadSkill } from '../../skills/loader';

const LoadSkillInput = z.object({
  name: z.string().min(1),
});

export function registerLoadSkill(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  getMcpSessionId: () => string | undefined,
): void {
  server.tool(
    'tempo_load_skill',
    `Load a bundled skill guide by name. Available skills: ${listSkills()
      .map((s) => `${s.name} — ${s.description}`)
      .join('; ')}`,
    LoadSkillInput.shape,
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
      const body = loadSkill(args.name);
      if (!body) {
        const available = listSkills()
          .map((s) => s.name)
          .join(', ');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'skill_not_found',
                message: `unknown skill "${args.name}". Available: ${available}`,
              }),
            },
          ],
        };
      }
      return { content: [{ type: 'text', text: body }] };
    },
  );
}
