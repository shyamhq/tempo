import { z } from 'zod';
import {
  Comment,
  CommentId,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  Reply,
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

export const SessionConnectedEvent = eventBase.extend({
  kind: z.literal('session_connected'),
});

export const SessionDisconnectedEvent = eventBase.extend({
  kind: z.literal('session_disconnected'),
});

export const DiscussionMessagePostedEvent = eventBase.extend({
  kind: z.literal('discussion_message_posted'),
  message: DiscussionMessage,
});

export const ThreadRenamedEvent = eventBase.extend({
  kind: z.literal('thread_renamed'),
  title: z.string().min(1).max(200),
});

export const Event = z.discriminatedUnion('kind', [
  CommentAddedEvent,
  ReplyAddedEvent,
  PlanEditedByDevEvent,
  PlanEditedByAgentEvent,
  StatusChangedEvent,
  CommentResolvedEvent,
  CommentUnresolvedEvent,
  AgentToolUseEvent,
  AgentNarrationEvent,
  AgentTodosUpdatedEvent,
  AgentTurnEndedEvent,
  SessionConnectedEvent,
  SessionDisconnectedEvent,
  DiscussionMessagePostedEvent,
  ThreadRenamedEvent,
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
  'agent_tool_use',
  'agent_narration',
  'agent_todos_updated',
  'agent_turn_ended',
  'session_connected',
  'session_disconnected',
  'discussion_message_posted',
  'thread_renamed',
]);
export type EventKind = z.infer<typeof EventKind>;
