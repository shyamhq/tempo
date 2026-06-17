import { PostReplyInput } from '@tempo/contracts/mcp';
import { postReply } from '@tempo/server';

import { threadIdRequired } from './_shared';

export function registerPostReply(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  resolveThreadId: () => Promise<string | null>,
): void {
  server.tool(
    'tempo_post_reply',
    'Post a reply to a Dev comment. Be direct, action-oriented, and concise — match the tone of a senior engineer responding to a code review comment. Acknowledge the concern; state what you will do or have done.',
    PostReplyInput.shape,
    async (args) => {
      const threadId = await resolveThreadId();
      if (!threadId) return threadIdRequired();
      try {
        const reply = await postReply(
          args.comment_id,
          args.payload,
          'agent',
          args.attachments,
          threadId,
        );
        return { content: [{ type: 'text', text: JSON.stringify({ reply_id: reply.id }) }] };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'comment_not_found') {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'comment_not_found' }) }],
          };
        }
        if (msg === 'forbidden') {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'forbidden' }) }],
          };
        }
        throw err;
      }
    },
  );
}
