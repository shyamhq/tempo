import { z } from 'zod';
import { Event } from './events';
import {
  AgentPlanState,
  AttachmentId,
  Comment,
  CommentId,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  MessageId,
  QuestionInput,
  ReplyId,
  ReplyPayload,
  ThreadSummary,
} from './primitives';

export const AttachInput = z.object({});
// `tempo_attach` returns the wire JSON in its first text content block. For
// vision: every `AttachmentRef` on a Discussion Message or Reply that belongs
// to one of the last N messages is also emitted as an MCP `image` content
// block (base64 payload, mime preserved) so Claude sees the picture, not just
// the ref. N is `ATTACH_INLINE_RECENT_MESSAGES` on the Agent.
export const AttachOutput = z.object({
  thread: ThreadSummary,
  plan: AgentPlanState,
  comments: z.array(Comment),
  discussion: z.object({
    messages: z.array(DiscussionMessage),
  }),
  last_event_id: EventId,
  workflow: z.string(),
});

export const PullPlanInput = z.object({});
export const PullPlanOutput = AgentPlanState;

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
// `tempo_poll` returns the events JSON in its first text content block, and
// emits one MCP `image` content block per attachment found on a live event
// (e.g. `discussion_message_posted`, `comment_added`, `reply_added`) so the
// Agent sees each picture exactly once as it arrives.
export const PollOutput = z.object({
  events: z.array(Event),
  cursor: EventId,
});

export const PostReplyInput = z.object({
  comment_id: CommentId,
  payload: ReplyPayload,
  attachments: z.array(AttachmentId).max(8).default([]),
});
export const PostReplyOutput = z.object({
  reply_id: ReplyId,
});

// One Discussion Message — free-form prose, an inline batch of structured
// questions (server assigns ids on insert), attachments, or any combination.
// Server-side rules: `author='agent'` is required to set `questions`; a
// message with no text, no questions, and no attachments is rejected.
export const PostDiscussionMessageInput = z
  .object({
    text: z.string().min(1).max(8_000).optional(),
    questions: z.array(QuestionInput).min(1).max(10).optional(),
    attachments: z.array(AttachmentId).max(8).default([]),
  })
  .refine((m) => m.text !== undefined || m.questions !== undefined || m.attachments.length > 0, {
    message: 'message must carry text, questions, attachments, or any combination',
  });
export const PostDiscussionMessageOutput = z.object({
  message_id: MessageId,
});

export const SetThreadMetaInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
});
export const SetThreadMetaOutput = z.object({ thread: ThreadSummary });

export const McpTool = z.enum([
  'tempo_attach',
  'tempo_pull_plan',
  'tempo_write_plan',
  'tempo_poll',
  'tempo_post_reply',
  'tempo_post_discussion_message',
  'tempo_set_thread_meta',
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
