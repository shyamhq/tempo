import { z } from 'zod';
import {
  Comment,
  CommentId,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  Reply,
  SessionId,
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

export const PlanEditedByDevEvent = eventBase.extend({
  kind: z.literal('plan_edited_by_dev'),
  updated_at: IsoTimestamp,
});

export const PlanEditedByAgentEvent = eventBase.extend({
  kind: z.literal('plan_edited_by_agent'),
  updated_at: IsoTimestamp,
});

export const StatusChangedEvent = eventBase.extend({
  kind: z.literal('status_changed'),
  from: ThreadStatus,
  to: ThreadStatus,
});

export const CommentResolvedEvent = eventBase.extend({
  kind: z.literal('comment_resolved'),
  comment_id: CommentId,
});

export const CommentUnresolvedEvent = eventBase.extend({
  kind: z.literal('comment_unresolved'),
  comment_id: CommentId,
});

export const CommentDeletedEvent = eventBase.extend({
  kind: z.literal('comment_deleted'),
  comment_id: CommentId,
});

export const AgentToolUseEvent = eventBase.extend({
  kind: z.literal('agent_tool_use'),
  tool: z.string().max(64),
  summary: z.string().max(200),
});

export const AgentNarrationEvent = eventBase.extend({
  kind: z.literal('agent_narration'),
  text: z.string().min(1).max(8000),
});

export const AgentTodo = z.object({
  content: z.string().max(500),
  status: z.enum(['pending', 'in_progress', 'completed']),
  activeForm: z.string().max(500).optional(),
});
export type AgentTodo = z.infer<typeof AgentTodo>;

export const AgentTodosUpdatedEvent = eventBase.extend({
  kind: z.literal('agent_todos_updated'),
  todos: z.array(AgentTodo).max(50),
});

export const AgentTurnEndedEvent = eventBase.extend({
  kind: z.literal('agent_turn_ended'),
});

export const AgentThoughtEvent = eventBase.extend({
  kind: z.literal('agent_thought'),
  text: z.string().min(1).max(8000),
});

export const AgentToolFailedEvent = eventBase.extend({
  kind: z.literal('agent_tool_failed'),
  tool: z.string().max(64),
});

export const AgentModeChangedEvent = eventBase.extend({
  kind: z.literal('agent_mode_changed'),
  mode_id: z.string().max(64),
});

export const SessionConnectedEvent = eventBase.extend({
  kind: z.literal('session_connected'),
});

export const SessionDisconnectedEvent = eventBase.extend({
  kind: z.literal('session_disconnected'),
});

// CLI emits before spawning claude; closes the dead zone between
// `tempo-agent connect` and the first `tempo_attach`.
export const SessionInitiatingEvent = eventBase.extend({
  kind: z.literal('session_initiating'),
});

// CLI emits on claude spawn error or non-zero exit; `reason` carries the
// raw error text (max 200 chars, no categorisation in MVP).
export const SessionFailedEvent = eventBase.extend({
  kind: z.literal('session_failed'),
  reason: z.string().max(200),
});

export const DiscussionMessagePostedEvent = eventBase.extend({
  kind: z.literal('discussion_message_posted'),
  message: DiscussionMessage,
});

export const ThreadRenamedEvent = eventBase.extend({
  kind: z.literal('thread_renamed'),
  title: z.string().min(1).max(200),
});

// Dev pressed Stop on the active Agent turn. The CLI matches session_id against
// its own TEMPO_SESSION_ID to ignore stale cancels meant for a prior session.
export const AgentCancelRequestedEvent = eventBase.extend({
  kind: z.literal('agent_cancel_requested'),
  session_id: SessionId,
});

export const Event = z.discriminatedUnion('kind', [
  CommentAddedEvent,
  ReplyAddedEvent,
  PlanEditedByDevEvent,
  PlanEditedByAgentEvent,
  StatusChangedEvent,
  CommentResolvedEvent,
  CommentUnresolvedEvent,
  CommentDeletedEvent,
  AgentToolUseEvent,
  AgentToolFailedEvent,
  AgentNarrationEvent,
  AgentThoughtEvent,
  AgentTodosUpdatedEvent,
  AgentModeChangedEvent,
  AgentTurnEndedEvent,
  SessionConnectedEvent,
  SessionDisconnectedEvent,
  SessionInitiatingEvent,
  SessionFailedEvent,
  DiscussionMessagePostedEvent,
  ThreadRenamedEvent,
  AgentCancelRequestedEvent,
]);
export type Event = z.infer<typeof Event>;

export const EventKind = z.enum([
  'comment_added',
  'reply_added',
  'plan_edited_by_dev',
  'plan_edited_by_agent',
  'status_changed',
  'comment_resolved',
  'comment_unresolved',
  'comment_deleted',
  'agent_tool_use',
  'agent_tool_failed',
  'agent_narration',
  'agent_thought',
  'agent_todos_updated',
  'agent_mode_changed',
  'agent_turn_ended',
  'session_connected',
  'session_disconnected',
  'session_initiating',
  'session_failed',
  'discussion_message_posted',
  'thread_renamed',
  'agent_cancel_requested',
]);
export type EventKind = z.infer<typeof EventKind>;

// Events that should wake the Agent for a new Turn. Dev-originated state
// changes only; `agent_*`/`session_*`/`plan_edited_by_agent`/`thread_renamed`
// are echoes the Agent itself produced. `agent_cancel_requested` is handled
// in-Turn (SIGINT-equivalent), not via re-spawn.
//
// `reply_added` and `discussion_message_posted` are kind-allowed but MUST
// be author-filtered — both Dev and Agent emit them; waking on Agent's own
// reply causes a ping-pong loop. Same logic applies to both Local CLI
// (per-Turn nudge) and Hosted Mailbox (per-VM-wake).
const WAKE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'comment_added',
  'reply_added',
  'comment_resolved',
  'comment_unresolved',
  'comment_deleted',
  'discussion_message_posted',
  'plan_edited_by_dev',
  'status_changed',
]);

export function shouldWake(event: Event): boolean {
  if (!WAKE_KINDS.has(event.kind)) return false;
  if (event.kind === 'reply_added') return event.reply.author === 'dev';
  if (event.kind === 'discussion_message_posted') return event.message.author === 'dev';
  return true;
}
