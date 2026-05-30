import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { SessionId, ThreadId } from '@tempo/contracts';
import {
  AskClarificationsInput,
  GetClarificationAnswersInput,
  PollInput,
  PostDiscussionMessageInput,
  PostReplyInput,
  WritePlanInput,
} from '@tempo/contracts/mcp';
import type { ConsoleClient } from './http-client';

export async function runStdioMcpServer(args: {
  client: ConsoleClient;
  sessionId: SessionId;
  threadId: ThreadId;
}): Promise<void> {
  const { client, sessionId, threadId } = args;
  const server = new McpServer({ name: 'tempo', version: '0.1.0' });

  server.registerTool(
    'tempo_attach',
    { description: 'Fetch initial Thread state.', inputSchema: {} },
    async () => wrap(await client.getSessionState(sessionId)),
  );

  server.registerTool(
    'tempo_pull_plan',
    { description: 'Read the current Plan.', inputSchema: {} },
    async () => wrap(await client.getPlan(threadId)),
  );

  server.registerTool(
    'tempo_write_plan',
    { description: 'Replace the Plan markdown.', inputSchema: WritePlanInput.shape },
    async (args) => wrap(await client.writePlan(threadId, args.markdown)),
  );

  server.registerTool(
    'tempo_ask_clarifications',
    {
      description: 'Open a Clarification Round with structured questions.',
      inputSchema: AskClarificationsInput.shape,
    },
    async (args) => {
      const r = await client.openRound(threadId, args.questions);
      return wrap({ round_id: r.round_id });
    },
  );

  server.registerTool(
    'tempo_get_clarification_answers',
    {
      description: "Read the Dev's answers to a Round; returns pending until submitted.",
      inputSchema: GetClarificationAnswersInput.shape,
    },
    async (args) => wrap(await client.getRoundAnswers(args.round_id)),
  );

  server.registerTool(
    'tempo_poll',
    {
      description: 'Long-poll the event stream for new events past cursor.',
      inputSchema: PollInput.shape,
    },
    async (args) => wrap(await client.poll(threadId, args.cursor)),
  );

  server.registerTool(
    'tempo_post_reply',
    { description: 'Post a Reply on a Comment.', inputSchema: PostReplyInput.shape },
    async (args) => {
      const reply = await client.postReply(args.comment_id, args.payload);
      return wrap({ reply_id: reply.id });
    },
  );

  server.registerTool(
    'tempo_post_discussion_message',
    {
      description:
        'Post a free-form Message in the Thread Discussion (unanchored, no Plan quote). Use for approach-level talk, not line-level pushback on the Plan (use tempo_post_reply for that).',
      inputSchema: PostDiscussionMessageInput.shape,
    },
    async (args) => {
      const message = await client.postDiscussionMessage(threadId, args.text);
      return wrap({ message_id: message.id });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

function wrap(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}
