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
    {
      description:
        'Always call first. Returns Thread state — title, description, status — plus Plan, open Comments, Discussion messages, pending Round, last event cursor, and the workflow guide for this session. Call again after any session resume or context compact.',
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
    'tempo_post_discussion_message',
    {
      description:
        "Post a free-form Message in the Thread Discussion (unanchored, no Plan quote). Use for approach-level talk about your reasoning, the codebase, or the Thread overall — not line-level pushback on the Plan (use tempo_post_reply for that). Same short, designer-to-PM tone as Replies: three short paragraphs at most, markdown welcome.\n\nIf multiple Dev Messages arrived since your last poll, send ONE Reply that addresses all of them — not N. If a change to the Plan is the right answer, just edit the Plan with tempo_write_plan and say so briefly here (\"Updated section 3 to use XState — see Plan.\"). Discussion Messages cannot carry edit proposals; the Plan is the artifact. When a Clarification Round is pending, finish it first.",
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
