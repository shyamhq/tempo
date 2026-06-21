import { z } from 'zod';
import type { AgentChunkFrame } from './agent-message';
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

// Agent activity (reasoning, tool calls, prose) is now the AI SDK
// UIMessage.parts representation (persisted as agent_messages, streamed as
// agent_chunk SSE frames), not bespoke events. The only agent-emitted event
// left is the turn boundary below — it's the event-log floor that
// getEventsSinceLastTurn reads to scope the next turn.
export const AgentTurnEndedEvent = eventBase.extend({
  kind: z.literal('agent_turn_ended'),
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

// Dev attached (or changed) the repo list for this Thread. Wakes the Agent
// so it can acknowledge the new context. repos is the full updated list.
export const RepoLinkedEvent = eventBase.extend({
  kind: z.literal('repo_linked'),
  repos: z.array(z.string()),
});

// VM provisioning state for the Console checklist. `phase` is DERIVED from the
// vm_runs row, not stored: no sandbox_id yet → `provisioning`; sandbox_id set →
// `cloning`. "done" is not a phase — it's agent presence (the runner connects
// its SSE before it would ever report "started", so presence is the ready
// signal). `failed` is terminal and carries a sanitized reason.
export const VmPhase = z.enum(['provisioning', 'cloning', 'failed']);
export type VmPhase = z.infer<typeof VmPhase>;

export const VmState = z.object({
  sandbox_id: z.string().nullable(),
  started_at: IsoTimestamp,
  phase: VmPhase,
  reason: z.string().optional(),
});
export type VmState = z.infer<typeof VmState>;

// Ephemeral SSE-only frame (NOT a persisted Event): the Worker XADDs it to the
// thread stream when an agent's SSE connection opens/closes so browsers flip the
// presence chip instantly. Never written to Postgres or the trail.
export const PresenceSignal = z.object({
  kind: z.literal('presence'),
  online: z.boolean(),
});
export type PresenceSignal = z.infer<typeof PresenceSignal>;

// Ephemeral SSE-only frame (NOT a persisted Event), sibling of PresenceSignal:
// the Worker XADDs it when a hosted VM is created, finishes booting, fails, or
// is torn down, so the Console's provisioning checklist tracks the Sandbox
// lifecycle live. `vm` is null when no Sandbox is provisioning. Browser-only.
export const VmSignal = z.object({
  kind: z.literal('vm'),
  vm: VmState.nullable(),
});
export type VmSignal = z.infer<typeof VmSignal>;

export const Event = z.discriminatedUnion('kind', [
  CommentAddedEvent,
  ReplyAddedEvent,
  PlanEditedByDevEvent,
  PlanEditedByAgentEvent,
  CommentResolvedEvent,
  CommentUnresolvedEvent,
  CommentDeletedEvent,
  AgentTurnEndedEvent,
  DiscussionMessagePostedEvent,
  ThreadRenamedEvent,
  AgentCancelRequestedEvent,
  RepoLinkedEvent,
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
  'agent_turn_ended',
  'discussion_message_posted',
  'thread_renamed',
  'agent_cancel_requested',
  'repo_linked',
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
  'repo_linked',
]);

export function shouldWake(event: Event): boolean {
  if (!WAKE_KINDS.has(event.kind)) return false;
  if (event.kind === 'reply_added') return event.reply.author_user_id !== null;
  if (event.kind === 'discussion_message_posted') {
    return event.message.author_user_id !== null;
  }
  return true;
}

// The only frames an Agent runtime acts on: human wake events + the Stop
// signal. The Worker filters Agent connections with this so plan edits,
// presence, the Agent's own echoes, and browser-only provisioning frames
// never ship; browsers get everything.
export function shouldDeliverToAgent(
  event: Event | PresenceSignal | VmSignal | AgentChunkFrame,
): boolean {
  if (event.kind === 'presence') return false;
  // vm is browser-only: provisioning status for the UI checklist.
  if (event.kind === 'vm') return false;
  // agent_chunk is the agent's own activity echo — browser-only, never fed back.
  if (event.kind === 'agent_chunk') return false;
  return shouldWake(event) || event.kind === 'agent_cancel_requested';
}
