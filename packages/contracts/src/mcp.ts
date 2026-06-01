import { z } from 'zod';
import { Event } from './events';
import {
  Comment,
  CommentId,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  MessageId,
  Plan,
  QuestionInput,
  ReplyId,
  ReplyPayload,
  ThreadSummary,
} from './primitives';

export const AttachInput = z.object({});
export const AttachOutput = z.object({
  thread: ThreadSummary,
  plan: Plan,
  comments: z.array(Comment),
  discussion: z.object({
    messages: z.array(DiscussionMessage),
  }),
  last_event_id: EventId,
  workflow: z.string(),
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

// One Discussion Message — free-form prose, an inline batch of structured
// questions (server assigns ids on insert), or both. Server-side rules:
// `author='agent'` is required to set `questions`; an empty body (no `text`
// and no `questions`) is rejected.
export const PostDiscussionMessageInput = z
  .object({
    text: z.string().min(1).max(8_000).optional(),
    questions: z.array(QuestionInput).min(1).max(10).optional(),
  })
  .refine((m) => m.text !== undefined || m.questions !== undefined, {
    message: 'message must carry text, questions, or both',
  });
export const PostDiscussionMessageOutput = z.object({
  message_id: MessageId,
});

export const McpTool = z.enum([
  'tempo_attach',
  'tempo_pull_plan',
  'tempo_write_plan',
  'tempo_poll',
  'tempo_post_reply',
  'tempo_post_discussion_message',
]);
export type McpTool = z.infer<typeof McpTool>;

export const McpErrorCode = z.enum([
  'thread_approved',
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
