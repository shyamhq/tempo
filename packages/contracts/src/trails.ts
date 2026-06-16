import { z } from 'zod';
import { AgentTodo, Event } from './events';
import { CommentId, EventId, IsoTimestamp, MessageId } from './primitives';

// A Trail is everything the Agent did to produce one output (a Comment reply,
// a Plan edit, or a Discussion message). Derived from the event log; not
// persisted as its own table. Same derivation runs server-side on initial
// fetch and client-side on each SSE event so the live trail extends as
// `agent_*` events arrive.

export const TrailStep = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool'),
    id: EventId,
    ts: IsoTimestamp,
    tool: z.string(),
    summary: z.string(),
  }),
  z.object({
    kind: z.literal('narration'),
    id: EventId,
    ts: IsoTimestamp,
    text: z.string(),
  }),
  z.object({
    kind: z.literal('todos'),
    id: EventId,
    ts: IsoTimestamp,
    todos: z.array(AgentTodo),
  }),
]);
export type TrailStep = z.infer<typeof TrailStep>;

export const TrailSurface = z.enum(['comment', 'plan', 'discussion', 'unknown']);
export type TrailSurface = z.infer<typeof TrailSurface>;

export const Trail = z.object({
  id: z.string(),
  surface: TrailSurface,
  target_id: z.union([CommentId, MessageId]).nullable(),
  output_text: z.string().nullable(),
  steps: z.array(TrailStep),
  started_at: IsoTimestamp,
  ended_at: IsoTimestamp.nullable(),
  status: z.enum(['live', 'done']),
});
export type Trail = z.infer<typeof Trail>;

const startTrail = (ev: Event): Trail => ({
  id: `live:${ev.id}`,
  surface: 'unknown',
  target_id: null,
  output_text: null,
  steps: [],
  started_at: ev.created_at,
  ended_at: null,
  status: 'live',
});

export function deriveTrails(events: Event[]): Trail[] {
  const done: Trail[] = [];
  let cur: Trail | null = null;

  for (const ev of events) {
    switch (ev.kind) {
      case 'agent_narration':
        cur ??= startTrail(ev);
        cur.steps.push({ kind: 'narration', id: ev.id, ts: ev.created_at, text: ev.text });
        break;
      case 'agent_tool_use':
        cur ??= startTrail(ev);
        cur.steps.push({
          kind: 'tool',
          id: ev.id,
          ts: ev.created_at,
          tool: ev.tool,
          summary: ev.summary,
        });
        break;
      case 'agent_todos_updated':
        cur ??= startTrail(ev);
        cur.steps.push({ kind: 'todos', id: ev.id, ts: ev.created_at, todos: ev.todos });
        break;
      case 'reply_added':
        if (ev.reply.author !== 'agent') break;
        cur ??= startTrail(ev);
        cur.id = ev.id;
        cur.surface = 'comment';
        cur.target_id = ev.comment_id;
        cur.output_text = ev.reply.payload.text;
        cur.ended_at = ev.created_at;
        cur.status = 'done';
        done.push(cur);
        cur = null;
        break;
      case 'plan_edited_by_agent':
        cur ??= startTrail(ev);
        cur.id = ev.id;
        cur.surface = 'plan';
        cur.output_text = null;
        cur.ended_at = ev.created_at;
        cur.status = 'done';
        done.push(cur);
        cur = null;
        break;
      case 'discussion_message_posted':
        if (ev.message.author !== 'agent') break;
        cur ??= startTrail(ev);
        cur.id = ev.id;
        cur.surface = 'discussion';
        cur.target_id = ev.message.id;
        cur.output_text = ev.message.text;
        cur.ended_at = ev.created_at;
        cur.status = 'done';
        done.push(cur);
        cur = null;
        break;
      case 'agent_turn_ended':
        // Anything still open at turn-end is wrap-up after the last output —
        // no artifact for the user to navigate to, so drop it. The genuinely
        // in-flight trail (no turn_ended yet) is preserved by the post-loop
        // push below.
        cur = null;
        break;
    }
  }
  if (cur) done.push(cur);
  return done.reverse();
}
