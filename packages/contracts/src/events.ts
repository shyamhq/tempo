import { z } from 'zod';
import {
  ActivityStatus,
  Actor,
  Comment,
  CommentId,
  EventId,
  IsoTimestamp,
  PendingRound,
  Plan,
  ProposalStatus,
  Reply,
  ReplyId,
  RoundId,
  ThreadStatus,
} from './primitives';

const eventBase = z.object({
  id: EventId,
  created_at: IsoTimestamp,
});

export const CommentAddedEvent = eventBase.extend({
  kind: z.literal('comment_added'),
  comment: Comment,
});

export const ReplyAddedEvent = eventBase.extend({
  kind: z.literal('reply_added'),
  comment_id: CommentId,
  reply: Reply,
});

export const ProposalDecidedEvent = eventBase.extend({
  kind: z.literal('proposal_decided'),
  reply_id: ReplyId,
  decision: ProposalStatus,
  rejection_reason: z.string().nullable(),
});

export const PlanEditedByDevEvent = eventBase.extend({
  kind: z.literal('plan_edited_by_dev'),
  updated_at: IsoTimestamp,
});

export const PlanEditedByAgentEvent = eventBase.extend({
  kind: z.literal('plan_edited_by_agent'),
  updated_at: IsoTimestamp,
});

export const RoundOpenedEvent = eventBase.extend({
  kind: z.literal('round_opened'),
  round: PendingRound,
});

export const RoundAnsweredEvent = eventBase.extend({
  kind: z.literal('round_answered'),
  round_id: RoundId,
});

export const StatusChangedEvent = eventBase.extend({
  kind: z.literal('status_changed'),
  from: ThreadStatus,
  to: ThreadStatus,
});

export const CommentResolvedEvent = eventBase.extend({
  kind: z.literal('comment_resolved'),
  comment_id: CommentId,
  actor: Actor,
});

export const CommentUnresolvedEvent = eventBase.extend({
  kind: z.literal('comment_unresolved'),
  comment_id: CommentId,
  actor: Actor,
});

export const CommentArchivedEvent = eventBase.extend({
  kind: z.literal('comment_archived'),
  comment_id: CommentId,
});

export const ActivityPillEvent = eventBase.extend({
  kind: z.literal('activity_pill'),
  status: ActivityStatus,
});

export const AgentToolUseEvent = eventBase.extend({
  kind: z.literal('agent_tool_use'),
  tool: z.string().max(64),
  summary: z.string().max(200),
});

export const SessionConnectedEvent = eventBase.extend({
  kind: z.literal('session_connected'),
});

export const SessionDisconnectedEvent = eventBase.extend({
  kind: z.literal('session_disconnected'),
});

export const Event = z.discriminatedUnion('kind', [
  CommentAddedEvent,
  ReplyAddedEvent,
  ProposalDecidedEvent,
  PlanEditedByDevEvent,
  PlanEditedByAgentEvent,
  RoundOpenedEvent,
  RoundAnsweredEvent,
  StatusChangedEvent,
  CommentResolvedEvent,
  CommentUnresolvedEvent,
  CommentArchivedEvent,
  ActivityPillEvent,
  AgentToolUseEvent,
  SessionConnectedEvent,
  SessionDisconnectedEvent,
]);
export type Event = z.infer<typeof Event>;

export const EventKind = z.enum([
  'comment_added',
  'reply_added',
  'proposal_decided',
  'plan_edited_by_dev',
  'plan_edited_by_agent',
  'round_opened',
  'round_answered',
  'status_changed',
  'comment_resolved',
  'comment_unresolved',
  'comment_archived',
  'activity_pill',
  'agent_tool_use',
  'session_connected',
  'session_disconnected',
]);
export type EventKind = z.infer<typeof EventKind>;
