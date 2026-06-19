import { z } from 'zod';
import { Comment, CommentId, DiscussionMessage, EventId, IsoTimestamp, Reply } from './primitives';

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

export const DiscussionMessagePostedEvent = eventBase.extend({
  kind: z.literal('discussion_message_posted'),
  message: DiscussionMessage,
});

export const ThreadRenamedEvent = eventBase.extend({
  kind: z.literal('thread_renamed'),
  title: z.string().min(1).max(200),
});

// Dev pressed Stop on the active Agent turn. Thread-scoped — every connected
// Agent on this Thread reacts. (Single-Agent-per-Thread is the only supported
// shape, so there is no per-session targeting.)
export const AgentCancelRequestedEvent = eventBase.extend({
  kind: z.literal('agent_cancel_requested'),
});

// Ephemeral SSE-only frame (NOT a persisted Event): the Worker XADDs it to the
// thread stream when an agent's SSE connection opens/closes so browsers flip the
// presence chip instantly. Never written to Postgres or the trail.
export const PresenceSignal = z.object({
  kind: z.literal('presence'),
  online: z.boolean(),
});
export type PresenceSignal = z.infer<typeof PresenceSignal>;

export const Event = z.discriminatedUnion('kind', [
  CommentAddedEvent,
  ReplyAddedEvent,
  PlanEditedByDevEvent,
  PlanEditedByAgentEvent,
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
  'discussion_message_posted',
  'thread_renamed',
  'agent_cancel_requested',
]);
export type EventKind = z.infer<typeof EventKind>;

// Events that should wake the Agent for a new Turn. Human-originated state
// changes only; `agent_*` / `plan_edited_by_agent` / `thread_renamed` are
// echoes the Agent itself produced. `agent_cancel_requested` is handled
// in-Turn (SIGINT-equivalent), not via re-spawn.
//
// `reply_added` and `discussion_message_posted` are kind-allowed but MUST
// be author-filtered — both human Devs and the Agent emit them; waking on
// the Agent's own reply causes a ping-pong loop. The Agent's own posts have
// `author_user_id === null`, so anything non-null is from a human.
//
// Mention-aware silencing happens inside the Agent's prompt, not here: every
// human message wakes the runtime, and the Agent decides whether to reply
// based on the `mentions` sidecar carried on the event payload.
//
// `plan_edited_by_dev` is intentionally NOT a wake kind. The Console's
// auto-save fires it on every debounce flush, so waking on it would spawn
// the hosted runner per-keystroke.
// `comment_resolved` / `comment_unresolved` / `comment_deleted` are Dev
// housekeeping — they reshape the comment surface but don't ask the Agent
// to produce new work.
const WAKE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'comment_added',
  'reply_added',
  'discussion_message_posted',
]);

export function shouldWake(event: Event): boolean {
  if (!WAKE_KINDS.has(event.kind)) return false;
  if (event.kind === 'reply_added') return event.reply.author_user_id !== null;
  if (event.kind === 'discussion_message_posted') {
    return event.message.author_user_id !== null;
  }
  return true;
}
