'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentTodo } from '@tempo/contracts';
import { Event, EventKind } from '@tempo/contracts/events';
import type { GetThreadResponse } from '@tempo/contracts/http';
import { useEffect, useRef } from 'react';
import type { z } from 'zod';
import { workerEventsUrl } from '../lib/api-client';

type ThreadView = z.infer<typeof GetThreadResponse>;

export type ActivityEntry =
  | { kind: 'tool'; id: string; tool: string; summary: string }
  | { kind: 'tool_failed'; id: string; tool: string }
  | { kind: 'narration'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string };

export type LiveActivity = {
  todos: AgentTodo[] | null;
  entries: ActivityEntry[];
  // True while Claude is mid-turn (a tool call has fired and no Stop hook has
  // landed since). The widget shows a spinner on the latest tool while
  // turnActive; on Stop it becomes a dot — the rest of the card stays.
  turnActive: boolean;
};

// Activity stream cap — keeps the in-memory list bounded if Claude bursts
// hundreds of tool calls or narration blocks between Dev messages.
const ACTIVITY_ENTRIES_MAX = 100;
const EMPTY_ACTIVITY: LiveActivity = {
  todos: null,
  entries: [],
  turnActive: false,
};

export const liveActivityKey = (threadId: string) => ['thread', threadId, 'live-activity'] as const;

// Cache-only read of the current "Agent activity" group: latest TodoWrite plus
// the activity entries (tool calls + narration) accumulated since the most
// recent Dev Discussion Message. SSE writes the value via `setQueryData`;
// this hook never fetches.
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
  const { getToken } = useAuth();
  const { user } = useUser();
  const cursorRef = useRef(initialCursor);
  cursorRef.current = initialCursor;
  // Latest-ref so a new callback identity on every parent render doesn't
  // re-subscribe (the effect deps are [threadId, qc] only).
  const planEditedByAgentRef = useRef(onPlanEditedByAgent);
  planEditedByAgentRef.current = onPlanEditedByAgent;
  // Keep the current user id in a ref so the SSE handler closure can read it
  // without being part of the effect deps (avoids re-subscribing on user change).
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  useEffect(() => {
    if (!threadId) return;
    // AbortController lets us cancel the fetchEventSource stream on cleanup.
    const controller = new AbortController();

    const run = async () => {
      await fetchEventSource(workerEventsUrl(threadId, cursorRef.current), {
        signal: controller.signal,
        // Override the underlying fetch so the library calls this on every
        // (re)connect. We fetch a fresh Clerk JWT each attempt — without this,
        // the library reuses headers captured at the first call, and a JWT
        // expiry mid-session permanently 401s the stream.
        fetch: async (input, init) => {
          const token = await getToken();
          return globalThis.fetch(input, {
            ...init,
            headers: {
              ...init?.headers,
              Authorization: token ? `Bearer ${token}` : '',
            },
          });
        },
        onopen: async (res) => {
          if (!res.ok) throw new Error(`SSE open failed: ${res.status}`);
        },
        onmessage: (msg) => {
          if (!msg.event || !EventKind.options.includes(msg.event as z.infer<typeof EventKind>))
            return;
          try {
            const parsed = Event.safeParse(JSON.parse(msg.data));
            if (!parsed.success) return;
            const ev = parsed.data;
            cursorRef.current = ev.id;
            apply(qc, threadId, ev, userIdRef.current);
            if (ev.kind === 'plan_edited_by_agent') planEditedByAgentRef.current?.();
          } catch {
            // ignore malformed frame
          }
        },
        onerror: (err) => {
          // Re-throw to let fetchEventSource retry with backoff. If aborted,
          // the library will not retry.
          throw err;
        },
      }).catch(() => {
        // Swallow abort errors on cleanup; other errors are retried by the library.
      });
    };

    run();

    return () => {
      controller.abort();
      // Drop the live activity entry so a remount or thread-switch doesn't
      // flash the previous Agent run's last todos or tool calls before fresh
      // events arrive.
      qc.removeQueries({ queryKey: liveActivityKey(threadId), exact: true });
    };
  }, [threadId, qc, getToken]);
}

function apply(
  qc: ReturnType<typeof useQueryClient>,
  threadId: string,
  ev: z.infer<typeof Event>,
  currentUserId: string | null,
): void {
  applyLiveActivity(qc, threadId, ev);

  const key = ['thread', threadId];
  qc.setQueryData<ThreadView>(key, (prev) => {
    if (!prev) return prev;
    // Any agent-authored event is proof of life — refresh the cached presence
    // timestamp so the chip doesn't say "idle" while a tool call is mid-flight.
    // The 30s refetch backstop covers quiet-but-connected periods; this covers
    // active-but-not-yet-refetched windows. `agent_cancel_requested` is
    // dev-authored (Stop button) and `agent_disconnected` is the goodbye —
    // both excluded here; the latter is handled explicitly below.
    const agentAlive =
      ev.kind === 'agent_tool_use' ||
      ev.kind === 'agent_tool_failed' ||
      ev.kind === 'agent_narration' ||
      ev.kind === 'agent_thought' ||
      ev.kind === 'agent_todos_updated' ||
      ev.kind === 'agent_mode_changed' ||
      ev.kind === 'agent_turn_ended' ||
      ev.kind === 'plan_edited_by_agent' ||
      (ev.kind === 'reply_added' && ev.reply.author_user_id === null) ||
      (ev.kind === 'discussion_message_posted' && ev.message.author_user_id === null);
    const next: ThreadView = {
      ...prev,
      last_event_id: ev.id,
      agent_last_seen_at: agentAlive ? new Date().toISOString() : prev.agent_last_seen_at,
    };
    switch (ev.kind) {
      case 'comment_added':
        if (next.comments.some((c) => c.id === ev.comment.id)) return next;
        return { ...next, comments: [...next.comments, ev.comment] };
      case 'reply_added': {
        // Dedup by reply id, same shape as `comment_added` above. The Dev's
        // own POST races the SSE event against the invalidate-refetch — if
        // the refetch returns first the new reply is already in the cache,
        // and the SSE event would otherwise append a second copy.
        return {
          ...next,
          comments: next.comments.map((c) => {
            if (c.id !== ev.comment_id) return c;
            if (c.replies.some((r) => r.id === ev.reply.id)) return c;
            return { ...c, replies: [...c.replies, ev.reply] };
          }),
        };
      }
      case 'plan_edited_by_dev':
      case 'plan_edited_by_agent': {
        // Body markdown is fetched on refetch (the SSE event carries only the timestamp).
        // Bump updated_at + updated_by_user_id together so the two metadata fields can't
        // disagree in the cache between the SSE write and the refetch landing.
        // agent edit → null; dev edit → current user id (best-effort; refetch corrects it).
        const updatedByUserId: string | null =
          ev.kind === 'plan_edited_by_agent' ? null : currentUserId;
        const body = next.plan.body
          ? { ...next.plan.body, updated_at: ev.updated_at, updated_by_user_id: updatedByUserId }
          : next.plan.body;
        return { ...next, plan: { ...next.plan, body } };
      }
      case 'comment_resolved':
        return {
          ...next,
          comments: next.comments.map((c) =>
            c.id === ev.comment_id ? { ...c, resolved_by_user_id: currentUserId } : c,
          ),
        };
      case 'comment_unresolved':
        return {
          ...next,
          comments: next.comments.map((c) =>
            c.id === ev.comment_id ? { ...c, resolved_by_user_id: null } : c,
          ),
        };
      case 'comment_deleted':
        return {
          ...next,
          comments: next.comments.filter((c) => c.id !== ev.comment_id),
        };
      case 'agent_disconnected':
        // CLI clean shutdown — null the presence so the UI flips to idle
        // immediately instead of waiting for the 60s window to age out.
        return { ...next, agent_last_seen_at: null };
      case 'discussion_message_posted': {
        if (next.discussion.messages.some((m) => m.id === ev.message.id)) return next;
        return {
          ...next,
          discussion: { messages: [...next.discussion.messages, ev.message] },
        };
      }
      case 'thread_renamed':
        return { ...next, thread: { ...next.thread, title: ev.title } };
      default:
        return next;
    }
  });

  // Plan edits change the markdown body — invalidate to refetch the canonical
  // text (D6: last-write-wins, Console is authoritative).
  if (ev.kind === 'plan_edited_by_agent' || ev.kind === 'plan_edited_by_dev') {
    qc.invalidateQueries({ queryKey: ['thread', threadId] });
  }

  // Trails are derived from the event log. Refetch when an Agent output
  // closes a trail; live in-flight steps render from `liveActivityKey`.
  if (
    ev.kind === 'reply_added' ||
    ev.kind === 'plan_edited_by_agent' ||
    ev.kind === 'discussion_message_posted' ||
    ev.kind === 'agent_turn_ended'
  ) {
    qc.invalidateQueries({ queryKey: ['trails', threadId] });
  }

  // Sidebar reads `['space-threads', spaceId]` independently of the Thread
  // view's cache — a rename has to ping it explicitly. Broad prefix match
  // avoids threading space_id through every event.
  if (ev.kind === 'thread_renamed') {
    qc.invalidateQueries({ queryKey: ['space-threads'] });
  }
}

// Append one activity entry and mark the turn active. Used by every
// agent_* event that adds a row — narration, thought, tool_failed.
// agent_tool_use stays inline because it ALSO flips turnActive distinctly
// (the initial tool call marks turn-start), kept separate for clarity.
function pushEntry(
  qc: ReturnType<typeof useQueryClient>,
  threadId: string,
  entry: ActivityEntry,
): void {
  qc.setQueryData<LiveActivity>(liveActivityKey(threadId), (prev) => {
    const base = prev ?? EMPTY_ACTIVITY;
    return {
      ...base,
      entries: [entry, ...base.entries].slice(0, ACTIVITY_ENTRIES_MAX),
      turnActive: true,
    };
  });
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
        const entry: ActivityEntry = {
          kind: 'tool',
          id: ev.id,
          tool: ev.tool,
          summary: ev.summary,
        };
        return {
          ...base,
          entries: [entry, ...base.entries].slice(0, ACTIVITY_ENTRIES_MAX),
          turnActive: true,
        };
      });
      return;
    case 'agent_narration':
      pushEntry(qc, threadId, { kind: 'narration', id: ev.id, text: ev.text });
      return;
    case 'agent_thought':
      pushEntry(qc, threadId, { kind: 'thought', id: ev.id, text: ev.text });
      return;
    case 'agent_tool_failed':
      pushEntry(qc, threadId, { kind: 'tool_failed', id: ev.id, tool: ev.tool });
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
      // and tool stream, then flip turnActive so the widget mounts immediately
      // with "Agent working…" instead of waiting on the Agent's first event.
      if (ev.message.author_user_id !== null) {
        qc.setQueryData<LiveActivity>(liveActivityKey(threadId), devTriggered);
      }
      return;
    case 'comment_added':
      qc.setQueryData<LiveActivity>(liveActivityKey(threadId), devTriggered);
      return;
    case 'reply_added':
      if (ev.reply.author_user_id !== null) {
        qc.setQueryData<LiveActivity>(liveActivityKey(threadId), devTriggered);
      }
      return;
  }
}

// Dev-side trigger: clear stale Agent state and mount the widget right away.
function devTriggered(): LiveActivity {
  return {
    todos: null,
    entries: [],
    turnActive: true,
  };
}
