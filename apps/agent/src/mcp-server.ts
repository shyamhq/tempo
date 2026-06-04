import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { SessionId, ThreadId } from '@tempo/contracts';
import {
  PollInput,
  PostDiscussionMessageInput,
  PostReplyInput,
  SetThreadMetaInput,
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
    {
      description:
        'Always call first. Returns Thread state — title, description, status — plus Plan, open Comments, Discussion messages, and the workflow guide for this session. Call again after any session resume or context compact.',
      inputSchema: {},
    },
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
    'tempo_poll',
    {
      description: 'Long-poll the event stream for new events past cursor.',
      inputSchema: PollInput.shape,
    },
    async (args) => wrap(await client.poll(threadId, args.cursor)),
  );

  server.registerTool(
    'tempo_post_reply',
    {
      description:
        'Post a Reply on a Comment. Plain markdown text — one paragraph at most, the less the better. Human, conversational tone. If you need to change the Plan, edit it first with tempo_write_plan, then post a Reply describing what you changed and why. If you want to suggest an edit before making it, write the suggestion in prose (e.g. "Planning to update the bullet about retries to read: *…* — confirm?") and wait for the Dev\'s text reply. No structured proposal payload; the conversation is the protocol.',
      inputSchema: PostReplyInput.shape,
    },
    async (args) => {
      const reply = await client.postReply(args.comment_id, args.payload);
      return wrap({ reply_id: reply.id });
    },
  );

  server.registerTool(
    'tempo_set_thread_meta',
    {
      description:
        'Set the Thread title (and optionally description). Only call when the title equals the literal placeholder "Untitled thread" — never rewrite a Dev-chosen title. Title: 3–6 words, no trailing punctuation. Derive from the first Dev Discussion Message.',
      inputSchema: SetThreadMetaInput.shape,
    },
    async (args) => {
      const { thread } = await client.updateThreadMeta(threadId, args);
      return wrap({ thread });
    },
  );

  server.registerTool(
    'tempo_post_discussion_message',
    {
      description:
        "Post one Message to the Thread Discussion. Two forms (use either, or both in one Message):\n\n• `text` — free-form prose. Use for approach-level talk about your reasoning, the codebase, or the Thread overall — not line-level pushback on the Plan (use tempo_post_reply for that). One paragraph at most, the less the better. Human, conversational tone. Markdown welcome.\n\n• `questions` — a batch of 1–10 structured questions (`single_choice` / `multi_choice` / `open_text`) that the Console renders as a stepper at the bottom of the Discussion. Use when you want clear decisions on specific things before you continue. Choice questions can `allow_other` for a Dev-typed write-in. The Dev's reply lands as a normal Discussion Message whose `text` formats the answers as `**<prompt>**\\n→ <answer>` — read it as prose; there is no separate answers payload.\n\nIf multiple Dev Messages arrived since your last poll, send ONE Reply that addresses all of them. If a change to the Plan is the right answer, just edit the Plan with tempo_write_plan and say so briefly here. The Plan is the artifact.",
      inputSchema: PostDiscussionMessageInput.shape,
    },
    async (args) => {
      const message = await client.postDiscussionMessage(threadId, args);
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
