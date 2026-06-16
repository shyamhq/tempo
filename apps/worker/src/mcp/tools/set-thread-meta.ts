import { SetThreadMetaInput } from '@tempo/contracts/mcp';
import { updateThread } from '@tempo/server';

import { sessionNotFound } from './_shared';

export function registerSetThreadMeta(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_set_thread_meta',
    "Update the Thread title and/or description. Call immediately after tempo_attach if thread.title === 'Untitled thread' — derive a 3–6-word title from the first Dev Discussion Message. Never overwrite a non-placeholder title.",
    SetThreadMetaInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return sessionNotFound();
      try {
        const thread = await updateThread(threadId, {
          title: args.title,
          description: args.description,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ thread }) }] };
      } catch (err) {
        if ((err as Error).message === 'thread_not_found') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'thread_not_found', message: 'thread not found' }),
              },
            ],
          };
        }
        throw err;
      }
    },
  );
}
