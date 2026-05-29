import { z } from 'zod';
import { Event } from './events';
import {
  ActivityStatus,
  Answer,
  Comment,
  CommentId,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  MessageId,
  PendingRound,
  Plan,
  Question,
  QuestionInput,
  ReplyId,
  ReplyPayload,
  RoundId,
  RoundStatus,
  ThreadSummary,
} from './primitives';

export const AttachInput = z.object({});
export const AttachOutput = z.object({
  thread: ThreadSummary,
  plan: Plan,
  pending_round: PendingRound.nullable(),
  comments: z.array(Comment),
  discussion: z.object({
    messages: z.array(DiscussionMessage),
  }),
  last_event_id: EventId,
});

export const PullPlanInput = z.object({});
export const PullPlanOutput = Plan;

export const WritePlanInput = z.object({
  markdown: z.string(),
});
export const WritePlanOutput = z.object({
  ok: z.literal(true),
  updated_at: IsoTimestamp,
});

// Agent supplies QuestionInput (no ids); server assigns ids.
export const AskClarificationsInput = z.object({
  questions: z.array(QuestionInput).min(1),
});
export const AskClarificationsOutput = z.object({
  round_id: RoundId,
});

export const GetClarificationAnswersInput = z.object({
  round_id: RoundId,
});
export const GetClarificationAnswersOutput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('answered'),
    answered_at: IsoTimestamp,
    answers: z.array(Answer),
  }),
]);

export const PollInput = z.object({
  cursor: EventId,
});
export const PollOutput = z.object({
  events: z.array(Event),
  cursor: EventId,
});

export const PostReplyInput = z.object({
  comment_id: CommentId,
  payload: ReplyPayload,
});
export const PostReplyOutput = z.object({
  reply_id: ReplyId,
});

export const PostDiscussionMessageInput = z.object({
  text: z.string().min(1).max(8_000),
});
export const PostDiscussionMessageOutput = z.object({
  message_id: MessageId,
});

export const SetStatusInput = ActivityStatus;
export const SetStatusOutput = z.object({
  ok: z.literal(true),
});

export const McpTool = z.enum([
  'tempo_attach',
  'tempo_pull_plan',
  'tempo_write_plan',
  'tempo_ask_clarifications',
  'tempo_get_clarification_answers',
  'tempo_poll',
  'tempo_post_reply',
  'tempo_post_discussion_message',
  'tempo_set_status',
]);
export type McpTool = z.infer<typeof McpTool>;

export const McpErrorCode = z.enum([
  'thread_approved',
  'round_already_pending',
  'round_pending',
  'round_not_found',
  'comment_not_found',
  'session_not_found',
  'invalid_cursor',
  'invalid_input',
  'internal_error',
]);
export type McpErrorCode = z.infer<typeof McpErrorCode>;

export const McpError = z.object({
  error: McpErrorCode,
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type McpError = z.infer<typeof McpError>;
