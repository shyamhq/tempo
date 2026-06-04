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
        'Post a Reply on a Comment. Three payload types: text (free-form), edit_done (point at a section that you already rewrote via tempo_write_plan), edit_proposed (target_section + replacement that the Dev decides on).\n\nStyle: short, designer-to-PM tone — what you did, why, the one takeaway. Three short paragraphs at most. Markdown renders (bold, inline code, fenced blocks, lists). Do not paste full test output, the entire verification log, or a step-by-step transcript — that work belongs in your session, not the rail.\n\nGood: "Verified — pino\'s default `err` serializer keeps `err.tempo` intact, so the structured-log path is fine. Updated the plan: removed the bullet that worried about #1; kept the #3 `process.argv[1]` bullet since I haven\'t run that smoke yet. Risk left: one false-positive with `JSON.stringify(err, Object.getOwnPropertyNames(err))`."\n\nBad: pasting the full debug output of three test runs, then re-stating each conclusion in prose, then quoting the resulting plan diff inline.',
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
        "Post one Message to the Thread Discussion. Two forms (use either, or both in one Message):\n\n• `text` — free-form prose. Use for approach-level talk about your reasoning, the codebase, or the Thread overall — not line-level pushback on the Plan (use tempo_post_reply for that). Designer-to-PM tone: three short paragraphs at most, markdown welcome.\n\n• `questions` — a batch of 1–10 structured questions (`single_choice` / `multi_choice` / `open_text`) that the Console renders as a stepper at the bottom of the Discussion. Use when you want clear decisions on specific things before you continue. Choice questions can `allow_other` for a Dev-typed write-in. The Dev's reply lands as a normal Discussion Message whose `text` formats the answers as `**<prompt>**\\n→ <answer>` — read it as prose; there is no separate answers payload.\n\nIf multiple Dev Messages arrived since your last poll, send ONE Reply that addresses all of them. If a change to the Plan is the right answer, just edit the Plan with tempo_write_plan and say so briefly here. Discussion Messages cannot carry edit proposals; the Plan is the artifact.",
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
