'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Event, EventKind } from '@tempo/contracts/events';
import type { GetThreadResponse } from '@tempo/contracts/http';
import type { z } from 'zod';

type ThreadView = z.infer<typeof GetThreadResponse>;

// SSE consumer for a single Thread. Mutates the cached Thread view via
// setQueryData so a single network stream feeds every Plan/Comment/Modal
// subscriber. Reconnects automatically (the browser's EventSource handles
// reconnects; we restart from the last applied event id).
export function useThreadEvents(threadId: string, initialCursor: string) {
  const qc = useQueryClient();
  const cursorRef = useRef(initialCursor);
  cursorRef.current = initialCursor;

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
    };
  }, [threadId, qc]);
}

function apply(
  qc: ReturnType<typeof useQueryClient>,
  threadId: string,
  ev: z.infer<typeof Event>,
): void {
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
            c.id === ev.comment_id
              ? { ...c, replies: [...c.replies, ev.reply] }
              : c,
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
        // Bump updated_at so subscribers see a change; consumers may invalidate to pull body.
        const body = next.plan.body
          ? { ...next.plan.body, updated_at: ev.updated_at }
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
            c.id === ev.comment_id ? { ...c, resolved_by: ev.actor } : c,
          ),
        };
      case 'comment_unresolved':
        return {
          ...next,
          comments: next.comments.map((c) =>
            c.id === ev.comment_id ? { ...c, resolved_by: null } : c,
          ),
        };
      case 'comment_archived': {
        const archived = next.comments.find((c) => c.id === ev.comment_id);
        return {
          ...next,
          comments: next.comments.filter((c) => c.id !== ev.comment_id),
          archived_comments: archived
            ? [
                ...next.archived_comments,
                { ...archived, archived_at: ev.created_at },
              ]
            : next.archived_comments,
        };
      }
      case 'activity_pill':
        return { ...next, activity: ev.status };
      case 'session_connected':
        return { ...next, session_status: 'connected' };
      case 'session_disconnected':
        return { ...next, session_status: 'disconnected' };
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
