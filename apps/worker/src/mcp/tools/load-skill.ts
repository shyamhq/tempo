import { z } from 'zod';
import { listSkills, loadSkill } from '../../skills/loader';

const LoadSkillInput = z.object({
  name: z.string().min(1),
});

import { threadIdRequired } from './_shared';

export function registerLoadSkill(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_load_skill',
    `Load a bundled skill guide by name. Available skills: ${listSkills()
      .map((s) => `${s.name} — ${s.description}`)
      .join('; ')}`,
    LoadSkillInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return threadIdRequired();
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
