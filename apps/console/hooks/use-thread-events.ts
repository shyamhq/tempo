'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Event, EventKind } from '@tempo/contracts/events';
import type { GetThreadResponse } from '@tempo/contracts/http';
import { useEffect, useRef } from 'react';
import type { z } from 'zod';

type ThreadView = z.infer<typeof GetThreadResponse>;

export type ToolFeedEntry = { id: string; tool: string; summary: string };
export const toolFeedKey = (threadId: string) => ['thread', threadId, 'tool-feed'] as const;

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
      // Drop the tool-feed entry so a remount or thread-switch doesn't flash
      // the previous Agent run's last tool call before fresh events arrive.
      qc.removeQueries({ queryKey: toolFeedKey(threadId), exact: true });
    };
  }, [threadId, qc]);
}

function apply(
  qc: ReturnType<typeof useQueryClient>,
  threadId: string,
  ev: z.infer<typeof Event>,
): void {
  if (ev.kind === 'agent_tool_use') {
    // Replace, not accumulate — UI shows only the latest tick.
    const entry: ToolFeedEntry = { id: ev.id, tool: ev.tool, summary: ev.summary };
    qc.setQueryData<ToolFeedEntry | null>(toolFeedKey(threadId), entry);
    return;
  }
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
      case 'round_opened':
        return { ...next, pending_round: ev.round };
      case 'round_answered':
        return { ...next, pending_round: null };
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
      case 'activity_pill':
        return { ...next, activity: ev.status };
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
