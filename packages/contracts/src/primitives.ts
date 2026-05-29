import { z } from 'zod';

export const ThreadId = z.string().regex(/^thr_[A-Z0-9]{26}$/);
export const SessionId = z.string().regex(/^ses_[A-Z0-9]{26}$/);
export const PlanId = z.string().regex(/^pln_[A-Z0-9]{26}$/);
export const CommentId = z.string().regex(/^cmt_[A-Z0-9]{26}$/);
export const ReplyId = z.string().regex(/^rep_[A-Z0-9]{26}$/);
export const RoundId = z.string().regex(/^rnd_[A-Z0-9]{26}$/);
export const EventId = z.string().regex(/^evt_[0-9]{14,}$/);
export const ConnectToken = z.string().regex(/^tmp_[A-Za-z0-9_-]{32,}$/);

export type ThreadId = z.infer<typeof ThreadId>;
export type SessionId = z.infer<typeof SessionId>;
export type PlanId = z.infer<typeof PlanId>;
export type CommentId = z.infer<typeof CommentId>;
export type ReplyId = z.infer<typeof ReplyId>;
export type RoundId = z.infer<typeof RoundId>;
export type EventId = z.infer<typeof EventId>;
export type ConnectToken = z.infer<typeof ConnectToken>;

// Sentinel matching newEventId(0) on the Console. Lexicographically less than
// every real event ID, so passing it as a cursor to longPoll/readEventsAfter
// returns all events since thread creation.
export const ZERO_EVENT_CURSOR: EventId = 'evt_00000000000000';

export const ThreadStatus = z.enum(['unapproved', 'approved']);
export const SessionStatus = z.enum(['pending', 'connected', 'disconnected']);
export const ActivityLabel = z.enum(['exploring', 'thinking', 'drafting', 'writing', 'idle']);
export const Actor = z.enum(['dev', 'agent']);
export const RoundStatus = z.enum(['pending', 'answered']);

export type ThreadStatus = z.infer<typeof ThreadStatus>;
export type SessionStatus = z.infer<typeof SessionStatus>;
export type ActivityLabel = z.infer<typeof ActivityLabel>;
export type Actor = z.infer<typeof Actor>;
export type RoundStatus = z.infer<typeof RoundStatus>;

export const IsoTimestamp = z.iso.datetime();
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export const ActivityStatus = z.object({
  label: ActivityLabel,
  detail: z.string().max(200).optional(),
});
export type ActivityStatus = z.infer<typeof ActivityStatus>;

export const PlanBody = z.object({
  markdown: z.string(),
  updated_at: IsoTimestamp,
  updated_by: Actor,
});
export type PlanBody = z.infer<typeof PlanBody>;

export const Plan = z.object({
  status: ThreadStatus,
  body: PlanBody.nullable(),
});
export type Plan = z.infer<typeof Plan>;

export const ThreadSummary = z.object({
  id: ThreadId,
  title: z.string(),
  description: z.string(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

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

export const Answer = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('single_choice'),
    value: z.union([z.string(), z.object({ other: z.string() })]),
  }),
  z.object({
    type: z.literal('multi_choice'),
    value: z.union([z.array(z.string()), z.object({ other: z.string() })]),
  }),
  z.object({
    type: z.literal('open_text'),
    value: z.string(),
  }),
]);
export type Answer = z.infer<typeof Answer>;

export const PendingRound = z.object({
  id: RoundId,
  questions: z.array(Question),
});
export type PendingRound = z.infer<typeof PendingRound>;

export const ReplyPayload = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('edit_done'),
    text: z.string(),
    section_ref: z.string(),
  }),
  z.object({
    type: z.literal('edit_proposed'),
    text: z.string(),
    target_section: z.string(),
    replacement: z.string(),
  }),
]);
export type ReplyPayload = z.infer<typeof ReplyPayload>;

export const ProposalStatus = z.enum(['accepted', 'rejected']);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const Reply = z.object({
  id: ReplyId,
  comment_id: CommentId,
  author: Actor,
  payload: ReplyPayload,
  proposal_status: ProposalStatus.nullable(),
  rejection_reason: z.string().nullable(),
  created_at: IsoTimestamp,
});
export type Reply = z.infer<typeof Reply>;

export const Comment = z.object({
  id: CommentId,
  thread_id: ThreadId,
  plan_quote: z.string(),
  plan_context: z.string(),
  resolved_by: Actor.nullable(),
  archived_at: IsoTimestamp.nullable(),
  created_at: IsoTimestamp,
  replies: z.array(Reply),
});
export type Comment = z.infer<typeof Comment>;
