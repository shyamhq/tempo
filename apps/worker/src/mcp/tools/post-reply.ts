import { PostReplyInput } from '@tempo/contracts/mcp';
import { getThreadIdForMcpSession } from '../../server/auth-lookup';
import { postReply } from '../../server/replies';

export function registerPostReply(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  getMcpSessionId: () => string | undefined,
): void {
  server.tool(
    'tempo_post_reply',
    'Post a reply to a Dev comment. Be direct, action-oriented, and concise — match the tone of a senior engineer responding to a code review comment. Acknowledge the concern; state what you will do or have done.',
    PostReplyInput.shape,
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
        const reply = await postReply(args.comment_id, args.payload, 'agent', args.attachments);
        return { content: [{ type: 'text', text: JSON.stringify({ reply_id: reply.id }) }] };
      } catch (err) {
        if ((err as Error).message === 'comment_not_found') {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'comment_not_found' }) }],
          };
        }
        throw err;
      }
    },
  );
}
