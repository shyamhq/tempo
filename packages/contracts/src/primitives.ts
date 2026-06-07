import { z } from 'zod';

export const ThreadId = z.string().regex(/^thr_[A-Z0-9]{26}$/);
export const SpaceId = z.string().regex(/^spc_[A-Z0-9]{26}$/);
export const SessionId = z.string().regex(/^ses_[A-Z0-9]{26}$/);
export const PlanId = z.string().regex(/^pln_[A-Z0-9]{26}$/);
export const CommentId = z.string().regex(/^cmt_[A-Z0-9]{26}$/);
export const ReplyId = z.string().regex(/^rep_[A-Z0-9]{26}$/);
export const MessageId = z.string().regex(/^msg_[A-Z0-9]{26}$/);
export const AttachmentId = z.string().regex(/^att_[A-Z0-9]{26}$/);
export const EventId = z.string().regex(/^evt_[0-9]{14,}$/);
export const ConnectToken = z.string().regex(/^tmp_[A-Za-z0-9_-]{32,}$/);

export type ThreadId = z.infer<typeof ThreadId>;
export type SpaceId = z.infer<typeof SpaceId>;
export type SessionId = z.infer<typeof SessionId>;
export type PlanId = z.infer<typeof PlanId>;
export type CommentId = z.infer<typeof CommentId>;
export type ReplyId = z.infer<typeof ReplyId>;
export type MessageId = z.infer<typeof MessageId>;
export type AttachmentId = z.infer<typeof AttachmentId>;
export type EventId = z.infer<typeof EventId>;
export type ConnectToken = z.infer<typeof ConnectToken>;

// Sentinel matching newEventId(0) on the Console. Lexicographically less than
// every real event ID, so passing it as a cursor to longPoll/readEventsAfter
// returns all events since thread creation.
export const ZERO_EVENT_CURSOR: EventId = 'evt_00000000000000';

export const ThreadStatus = z.enum(['unapproved', 'approved']);
export const SessionStatus = z.enum(['pending', 'connected', 'disconnected']);
export const Actor = z.enum(['dev', 'agent']);

export type ThreadStatus = z.infer<typeof ThreadStatus>;
export type SessionStatus = z.infer<typeof SessionStatus>;
export type Actor = z.infer<typeof Actor>;

export const IsoTimestamp = z.iso.datetime();
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

// The Plan body is the editor's ProseMirror JSON — the full document state
// the BlockNote editor uses internally. Blocks JSON would be a lossy
// projection (BlockNote drops `blocknoteIgnore` marks like `comment` during
// the blocks projection), so we persist the deeper PM JSON layer instead.
// We keep the shape as `z.unknown()` at the contract level because the
// concrete shape comes from BlockNote/TipTap, not Tempo's contracts.
export const PlanBody = z.object({
  pm_json: z.unknown(),
  updated_at: IsoTimestamp,
  updated_by: Actor,
});
export type PlanBody = z.infer<typeof PlanBody>;

export const Plan = z.object({
  status: ThreadStatus,
  body: PlanBody.nullable(),
});
export type Plan = z.infer<typeof Plan>;

// Agent-facing projection of a Plan. Structurally identical to `PlanBody`
// today; kept as a separate name so the MCP contract can evolve agent-only
// fields without rippling into Console types.
export const AgentPlanBody = z.object({
  pm_json: z.unknown(),
  updated_at: IsoTimestamp,
  updated_by: Actor,
});
export type AgentPlanBody = z.infer<typeof AgentPlanBody>;

export const AgentPlanState = z.object({
  status: ThreadStatus,
  body: AgentPlanBody.nullable(),
});
export type AgentPlanState = z.infer<typeof AgentPlanState>;

export const ThreadSummary = z.object({
  id: ThreadId,
  title: z.string(),
  description: z.string(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

export const Space = z.object({
  id: SpaceId,
  name: z.string(),
  thread_count: z.number().int().nonnegative(),
  // Exposed so the sidebar can compute fractional-indexing midpoints
  // (drop-between-neighbours) without a separate `before/after` endpoint.
  sort_order: z.number(),
});
export type Space = z.infer<typeof Space>;

export const SpaceThreadLite = z.object({
  id: ThreadId,
  title: z.string(),
  status: ThreadStatus,
  sort_order: z.number(),
});
export type SpaceThreadLite = z.infer<typeof SpaceThreadLite>;

export const QuestionType = z.enum(['single_choice', 'multi_choice', 'open_text']);
export type QuestionType = z.infer<typeof QuestionType>;

export const QuestionInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('single_choice'),
    prompt: z.string(),
    options: z.array(z.string()).min(2),
    allow_other: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('multi_choice'),
    prompt: z.string(),
    options: z.array(z.string()).min(2),
    allow_other: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('open_text'),
    prompt: z.string(),
  }),
]);
export type QuestionInput = z.infer<typeof QuestionInput>;

export const Question = z.intersection(QuestionInput, z.object({ id: z.string() }));
export type Question = z.infer<typeof Question>;

export const ReplyPayload = z.object({
  text: z.string(),
});
export type ReplyPayload = z.infer<typeof ReplyPayload>;

// An Attachment is bound to a single parent (Message OR Reply). On the read
// shape, `url` is a freshly signed GET URL with `expires_at` tracking its TTL;
// the server re-signs at every read so signatures never escape into stored
// payloads (notably the event log carries ids only).
export const AttachmentRef = z.object({
  id: AttachmentId,
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byte_len: z.number().int().positive(),
  url: z.string().url(),
  expires_at: IsoTimestamp,
});
export type AttachmentRef = z.infer<typeof AttachmentRef>;

export const Reply = z.object({
  id: ReplyId,
  comment_id: CommentId,
  author: Actor,
  payload: ReplyPayload,
  attachments: z.array(AttachmentRef).default([]),
  created_at: IsoTimestamp,
});
export type Reply = z.infer<typeof Reply>;

export const Comment = z.object({
  id: CommentId,
  thread_id: ThreadId,
  plan_quote: z.string(),
  plan_context: z.string(),
  resolved_by: z.literal('dev').nullable(),
  created_at: IsoTimestamp,
  replies: z.array(Reply),
});
export type Comment = z.infer<typeof Comment>;

// A Discussion Message carries free-form text, an inline structured Question
// batch, or both. Authoring rules (Agent-only for `questions`, non-empty body)
// live in the server module — enforced where the row is written, not on the
// read shape.
export const DiscussionMessage = z.object({
  id: MessageId,
  thread_id: ThreadId,
  author: Actor,
  text: z.string().min(1).max(8_000).nullable(),
  questions: z.array(Question).nullable(),
  attachments: z.array(AttachmentRef).default([]),
  created_at: IsoTimestamp,
});
export type DiscussionMessage = z.infer<typeof DiscussionMessage>;
