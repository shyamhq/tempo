'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentTodo } from '@tempo/contracts';
import { Event, EventKind } from '@tempo/contracts/events';
import type { GetThreadResponse } from '@tempo/contracts/http';
import { useEffect, useRef } from 'react';
import type { z } from 'zod';

type ThreadView = z.infer<typeof GetThreadResponse>;

export type ToolCallEntry = { id: string; tool: string; summary: string };
export type LiveActivity = {
  todos: AgentTodo[] | null;
  toolCalls: ToolCallEntry[];
  // True while Claude is mid-turn (a tool call has fired and no Stop hook has
  // landed since). The widget shows a spinner on the latest tool while
  // turnActive; on Stop it becomes a dot — the rest of the card stays.
  turnActive: boolean;
};

// Tool stream cap — keeps the in-memory list bounded if Claude bursts hundreds
// of tool calls between Dev messages.
const TOOL_CALLS_MAX = 100;
const EMPTY_ACTIVITY: LiveActivity = { todos: null, toolCalls: [], turnActive: false };

export const liveActivityKey = (threadId: string) => ['thread', threadId, 'live-activity'] as const;

// Cache-only read of the current "Agent activity" group: latest TodoWrite plus
// the tool calls accumulated since the most recent Dev Discussion Message.
// SSE writes the value via `setQueryData`; this hook never fetches.
export function useLiveActivityGroup(threadId: string): LiveActivity {
  const { data } = useQuery<LiveActivity>({
    queryKey: liveActivityKey(threadId),
    queryFn: () => EMPTY_ACTIVITY,
    initialData: EMPTY_ACTIVITY,
    staleTime: Infinity,
    enabled: false,
  });
  return data ?? EMPTY_ACTIVITY;
}

// SSE consumer for a single Thread. Mutates the cached Thread view via
// setQueryData so a single network stream feeds every Plan/Comment/Modal
// subscriber. Reconnects automatically (the browser's EventSource handles
// reconnects; we restart from the last applied event id).
//
// `onPlanEditedByAgent` is the direct trigger for the "Plan updated by Agent"
// UI (toast + editor ring pulse) — fired at the SSE boundary so it can't be
// lost in a cache-diff race between updated_at and updated_by.
export function useThreadEvents(
  threadId: string,
  initialCursor: string,
  onPlanEditedByAgent?: () => void,
) {
  const qc = useQueryClient();
  const cursorRef = useRef(initialCursor);
  cursorRef.current = initialCursor;
  // Latest-ref so a new callback identity on every parent render doesn't
  // re-subscribe the EventSource (the effect deps are [threadId, qc] only).
  const planEditedByAgentRef = useRef(onPlanEditedByAgent);
  planEditedByAgentRef.current = onPlanEditedByAgent;

  useEffect(() => {
    if (!threadId) return;
    let stopped = false;
    let es: EventSource | null = null;

    const open = () => {
      if (stopped) return;
      const url = `/api/threads/${threadId}/events?cursor=${encodeURIComponent(cursorRef.current)}`;
      es = new EventSource(url);
      const handle = (msg: MessageEvent) => {
        try {
          const parsed = Event.safeParse(JSON.parse(msg.data));
          if (!parsed.success) return;
          const ev = parsed.data;
          cursorRef.current = ev.id;
          apply(qc, threadId, ev);
          if (ev.kind === 'plan_edited_by_agent') planEditedByAgentRef.current?.();
        } catch {
          // ignore malformed frame
        }
      };
      // Server emits `event: <kind>` frames — EventSource routes those to
      // named listeners, not onmessage. Subscribe to every known kind.
      for (const kind of EventKind.options) {
        es.addEventListener(kind, handle as EventListener);
      }
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        // brief backoff before reconnect
        setTimeout(open, 1500);
      };
    };
    open();
    return () => {
      stopped = true;
      es?.close();
      // Drop the live activity entry so a remount or thread-switch doesn't
      // flash the previous Agent run's last todos or tool calls before fresh
      // events arrive.
      qc.removeQueries({ queryKey: liveActivityKey(threadId), exact: true });
    };
  }, [threadId, qc]);
}

function apply(
  qc: ReturnType<typeof useQueryClient>,
  threadId: string,
  ev: z.infer<typeof Event>,
): void {
  applyLiveActivity(qc, threadId, ev);

  const key = ['thread', threadId];
  qc.setQueryData<ThreadView>(key, (prev) => {
    if (!prev) return prev;
    const next: ThreadView = {
      ...prev,
      last_event_id: ev.id,
    };
    switch (ev.kind) {
      case 'comment_added':
        if (next.comments.some((c) => c.id === ev.comment.id)) return next;
        return { ...next, comments: [...next.comments, ev.comment] };
      case 'reply_added': {
        return {
          ...next,
          comments: next.comments.map((c) =>
            c.id === ev.comment_id ? { ...c, replies: [...c.replies, ev.reply] } : c,
          ),
        };
      }
      case 'proposal_decided': {
        return {
          ...next,
          comments: next.comments.map((c) => ({
            ...c,
            replies: c.replies.map((r) =>
              r.id === ev.reply_id
                ? {
                    ...r,
                    proposal_status: ev.decision,
                    rejection_reason: ev.rejection_reason,
                  }
                : r,
            ),
          })),
        };
      }
      case 'plan_edited_by_dev':
      case 'plan_edited_by_agent': {
        // Body markdown is fetched on refetch (the SSE event carries only the timestamp).
        // Bump updated_at + updated_by together so the two metadata fields can't disagree
        // in the cache between the SSE write and the refetch landing.
        const by: 'agent' | 'dev' = ev.kind === 'plan_edited_by_agent' ? 'agent' : 'dev';
        const body = next.plan.body
          ? { ...next.plan.body, updated_at: ev.updated_at, updated_by: by }
          : next.plan.body;
        return { ...next, plan: { ...next.plan, body } };
      }
      case 'status_changed':
        return {
          ...next,
          status: ev.to,
          plan: { ...next.plan, status: ev.to },
        };
      case 'comment_resolved':
        return {
          ...next,
          comments: next.comments.map((c) =>
            c.id === ev.comment_id ? { ...c, resolved_by: 'dev' } : c,
          ),
        };
      case 'comment_unresolved':
        return {
          ...next,
          comments: next.comments.map((c) =>
            c.id === ev.comment_id ? { ...c, resolved_by: null } : c,
          ),
        };
      case 'session_connected':
        return { ...next, session_status: 'connected' };
      case 'session_disconnected':
        return { ...next, session_status: 'disconnected' };
      case 'discussion_message_posted': {
        if (next.discussion.messages.some((m) => m.id === ev.message.id)) return next;
        return {
          ...next,
          discussion: { messages: [...next.discussion.messages, ev.message] },
        };
      }
      default:
        return next;
    }
  });

  // Plan edits change the markdown body — invalidate to refetch the canonical
  // text (D6: last-write-wins, Console is authoritative).
  if (ev.kind === 'plan_edited_by_agent' || ev.kind === 'plan_edited_by_dev') {
    qc.invalidateQueries({ queryKey: ['thread', threadId] });
  }
}

function applyLiveActivity(
  qc: ReturnType<typeof useQueryClient>,
  threadId: string,
  ev: z.infer<typeof Event>,
): void {
  switch (ev.kind) {
    case 'agent_tool_use':
      qc.setQueryData<LiveActivity>(liveActivityKey(threadId), (prev) => {
        const base = prev ?? EMPTY_ACTIVITY;
        const entry: ToolCallEntry = { id: ev.id, tool: ev.tool, summary: ev.summary };
        return {
          ...base,
          toolCalls: [entry, ...base.toolCalls].slice(0, TOOL_CALLS_MAX),
          turnActive: true,
        };
      });
      return;
    case 'agent_todos_updated':
      // Empty array means Claude cleared its list — normalize to `null` so the
      // type's "no todos" branch is the single source of truth for the UI.
      qc.setQueryData<LiveActivity>(liveActivityKey(threadId), (prev) => ({
        ...(prev ?? EMPTY_ACTIVITY),
        todos: ev.todos.length > 0 ? ev.todos : null,
      }));
      return;
    case 'agent_turn_ended':
      // Claude stopped — keep the last todos + tool stream visible (final
      // state context) but flip the spinner off.
      qc.setQueryData<LiveActivity>(liveActivityKey(threadId), (prev) => ({
        ...(prev ?? EMPTY_ACTIVITY),
        turnActive: false,
      }));
      return;
    case 'discussion_message_posted':
      // Dev message starts a fresh Agent turn — drop the previous turn's todos
      // and tool stream so the activity group doesn't render stale state above
      // the new message.
      if (ev.message.author === 'dev') {
        qc.setQueryData<LiveActivity>(liveActivityKey(threadId), EMPTY_ACTIVITY);
      }
      return;
  }
}
