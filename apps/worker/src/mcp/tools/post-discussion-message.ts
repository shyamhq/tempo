import { PostDiscussionMessageInput } from '@tempo/contracts/mcp';
import { postMessage } from '@tempo/server';

import { sessionNotFound } from './_shared';

export function registerPostDiscussionMessage(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_post_discussion_message',
    'Post a Discussion Message to the Thread. Use for free-form prose replies to the Dev, or to post a batch of structured questions (questions array). The Dev sees question batches as a stepper card. Only agents may set questions; dev messages are text-only.',
    PostDiscussionMessageInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return sessionNotFound();
      try {
        const message = await postMessage(threadId, 'agent', args);
        return { content: [{ type: 'text', text: JSON.stringify({ message_id: message.id }) }] };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'invalid_input') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'invalid_input',
                  message: 'message must carry text, questions, or attachments',
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
