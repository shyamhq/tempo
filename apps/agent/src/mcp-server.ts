import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { ActivityStatus, type SessionId, type ThreadId } from '@tempo/contracts';
import {
  AskClarificationsInput,
  GetClarificationAnswersInput,
  PollInput,
  PostReplyInput,
  ResolveCommentInput,
  WritePlanInput,
} from '@tempo/contracts/mcp';
import type { ConsoleClient } from './http-client';

type Json = unknown;

export function buildMcpServer(
  client: ConsoleClient,
  sessionId: SessionId,
  threadId: ThreadId,
) {
  return createSdkMcpServer({
    name: 'tempo',
    version: '0.1.0',
    instructions:
      'Tempo planning tools. Use tempo_attach first to load Thread state, then tempo_set_status between actions, tempo_ask_clarifications to ask the Dev, tempo_pull_plan + tempo_write_plan to revise the Plan, and tempo_poll to wait on events.',
    tools: [
      tool('tempo_attach', 'Fetch initial Thread state.', {}, async () =>
        wrap(await client.getSessionState(sessionId)),
      ),

      tool('tempo_pull_plan', 'Read the current Plan.', {}, async () =>
        wrap(await client.getPlan(threadId)),
      ),

      tool('tempo_write_plan', 'Replace the Plan markdown.', WritePlanInput.shape, async (args) =>
        wrap(await client.writePlan(threadId, args.markdown)),
      ),

      tool(
        'tempo_ask_clarifications',
        'Open a Clarification Round with structured questions.',
        AskClarificationsInput.shape,
        async (args) => {
          const r = await client.openRound(threadId, args.questions);
          return wrap({ round_id: r.round_id });
        },
      ),

      tool(
        'tempo_get_clarification_answers',
        'Read the Devs answers to a Round; returns pending until submitted.',
        GetClarificationAnswersInput.shape,
        async (args) => wrap(await client.getRoundAnswers(args.round_id)),
      ),

      tool(
        'tempo_poll',
        'Long-poll the event stream for new events past cursor.',
        PollInput.shape,
        async (args) => wrap(await client.poll(threadId, args.cursor)),
      ),

      tool(
        'tempo_post_reply',
        'Post a Reply on a Comment.',
        PostReplyInput.shape,
        async (args) => {
          const reply = await client.postReply(args.comment_id, args.payload);
          return wrap({ reply_id: reply.id });
        },
      ),

      tool(
        'tempo_resolve_comment',
        'Resolve a Comment.',
        ResolveCommentInput.shape,
        async (args) => wrap(await client.resolveComment(args.comment_id)),
      ),

      tool(
        'tempo_set_status',
        'Report Agent activity (exploring/thinking/drafting/writing/idle).',
        ActivityStatus.shape,
        async (args) => wrap(await client.setActivityStatus(sessionId, args)),
      ),
    ],
  });
}

function wrap(payload: Json) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}
