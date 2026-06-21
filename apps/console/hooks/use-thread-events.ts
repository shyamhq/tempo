'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { stripEmptyAgentText } from '@tempo/contracts';
import type {
  AgentChunkFrame,
  TempoUIMessage,
  UIMessageChunk,
} from '@tempo/contracts/agent-message';
import { Event, PresenceSignal, VmSignal } from '@tempo/contracts/events';
import type { GetThreadResponse } from '@tempo/contracts/http';
import { subscribeToEvents } from '@tempo/sse-client';
import { readUIMessageStream } from 'ai';
import { useEffect, useRef } from 'react';
import type { z } from 'zod';
import { workerEventsUrl } from '../lib/api-client';
import { useAgentMessagesStore } from '../store/agent-messages';

type ThreadView = z.infer<typeof GetThreadResponse>;

// SSE consumer for a single Thread. Mutates the cached Thread view via
// setQueryData so a single network stream feeds every Plan/Comment/Modal
// subscriber. Reconnects automatically (the transport resumes via Last-Event-ID).
//
// Last-Event-ID replays the events missed during a brief drop. A reconnect also
// invalidates ['thread', threadId] as the backstop for the rare case the gap
// outlived the Redis stream's MAXLEN trim and some ids are gone.
//
// `onPlanEditedByAgent` is the direct trigger for the "Plan updated by Agent"
// UI (toast + editor ring pulse) — fired at the SSE boundary so it can't be
// lost in a cache-diff race between updated_at and updated_by.
export function useThreadEvents(threadId: string, onPlanEditedByAgent?: () => void) {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const { user } = useUser();
  // Latest-ref so a new callback identity on every parent render doesn't
  // re-subscribe (the effect deps are [threadId, qc] only).
  const planEditedByAgentRef = useRef(onPlanEditedByAgent);
  planEditedByAgentRef.current = onPlanEditedByAgent;
  // Keep the current user id in a ref so the SSE handler closure can read it
  // without being part of the effect deps (avoids re-subscribing on user change).
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  // Live chunk-stream bridge. One live turn streams at a time (the producer holds
  // a per-thread turn lock), so a single ReadableStream controller suffices:
  // agent_chunk frames enqueue here and readUIMessageStream assembles successive
  // UIMessage snapshots into the zustand store.
  const liveTurnRef = useRef<{
    turn: string;
    controller: ReadableStreamDefaultController<UIMessageChunk>;
  } | null>(null);

  useEffect(() => {
    if (!threadId) return;
    const { setLiveMessage, clearLiveMessage } = useAgentMessagesStore.getState();
    const closeLiveTurn = () => {
      if (!liveTurnRef.current) return;
      try {
        liveTurnRef.current.controller.close();
      } catch {
        /* already closed */
      }
      liveTurnRef.current = null;
    };

    const sub = subscribeToEvents({
      url: workerEventsUrl(threadId),
      // Fresh Clerk JWT on every (re)connect so a mid-session expiry doesn't
      // permanently 401 the stream.
      getToken: async () => (await getToken()) ?? '',
      onOpen: (reconnected) => {
        // MAXLEN-trim backstop: if the drop outlived the Redis stream window,
        // Last-Event-ID can't replay it — pull full state from DB. The normal
        // (in-window) case is covered by the replay, so first open skips this.
        if (reconnected) qc.invalidateQueries({ queryKey: ['thread', threadId] });
      },
      onMessage: (data) => {
        // agent_chunk is an SSE-only frame (not in the Event union). Bridge the
        // chunk into a per-turn ReadableStream so readUIMessageStream assembles
        // a live UIMessage snapshot written directly to the zustand store.
        if (
          data !== null &&
          typeof data === 'object' &&
          (data as Record<string, unknown>).kind === 'agent_chunk'
        ) {
          const { turn, chunk } = data as AgentChunkFrame;
          if (liveTurnRef.current?.turn !== turn) {
            closeLiveTurn(); // a new turn id replaces any prior live stream
            let ctrl!: ReadableStreamDefaultController<UIMessageChunk>;
            const stream = new ReadableStream<UIMessageChunk>({
              start(c) {
                ctrl = c;
              },
            });
            liveTurnRef.current = { turn, controller: ctrl };
            // Drive the async iterator in the background — each new UIMessage
            // snapshot overwrites the live slot in the store.
            void (async () => {
              try {
                for await (const msg of readUIMessageStream({ stream })) {
                  setLiveMessage(threadId, stripEmptyAgentText(msg as TempoUIMessage));
                }
              } catch (streamErr) {
                if (process.env.NODE_ENV !== 'production') {
                  console.warn('agent-chunk: readUIMessageStream error', turn, streamErr);
                }
              }
            })();
          }
          liveTurnRef.current?.controller.enqueue(chunk);
          return;
        }

        // presence is an SSE-only signal (not in the Event union) — try it first
        // so it isn't dropped by the Event guard.
        const presence = PresenceSignal.safeParse(data);
        if (presence.success) {
          qc.setQueryData<ThreadView>(['thread', threadId], (prev) =>
            prev ? { ...prev, agent_present: presence.data.online } : prev,
          );
          return;
        }
        // vm is an SSE-only signal (not in the Event union) — the VM provisioning
        // lifecycle. Patch the thread view's `vm` exactly like presence above.
        const vmSig = VmSignal.safeParse(data);
        if (vmSig.success) {
          qc.setQueryData<ThreadView>(['thread', threadId], (prev) =>
            prev ? { ...prev, vm: vmSig.data.vm } : prev,
          );
          return;
        }
        const parsed = Event.safeParse(data);
        if (!parsed.success) return;
        const ev = parsed.data;
        apply(qc, threadId, ev, userIdRef.current);
        if (ev.kind === 'plan_edited_by_agent') planEditedByAgentRef.current?.();

        // A finished turn: close the live stream and refetch. The persisted
        // message carries the same id, so the merge dedupes the live slot away —
        // gapless, no timer. The live slot is overwritten on the next turn.
        if (ev.kind === 'agent_turn_ended') {
          closeLiveTurn();
          qc.invalidateQueries({ queryKey: ['agent-messages', threadId] });
        }
      },
    });

    return () => {
      sub.close();
      closeLiveTurn();
      clearLiveMessage(threadId);
    };
  }, [threadId, qc, getToken]);
}

function apply(
  qc: ReturnType<typeof useQueryClient>,
  threadId: string,
  ev: z.infer<typeof Event>,
  currentUserId: string | null,
): void {
  const key = ['thread', threadId];
  qc.setQueryData<ThreadView>(key, (prev) => {
    if (!prev) return prev;
    const next: ThreadView = { ...prev };
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

  // Sidebar reads `['space-threads', spaceId]` independently of the Thread
  // view's cache — a rename has to ping it explicitly. Broad prefix match
  // avoids threading space_id through every event.
  if (ev.kind === 'thread_renamed') {
    qc.invalidateQueries({ queryKey: ['space-threads'] });
  }

  // repo_linked means the server has updated threads.repos — invalidate the
  // composer's repo query so the thread-context bar reflects the new list
  // immediately without a manual refetch.
  if (ev.kind === 'repo_linked') {
    qc.invalidateQueries({ queryKey: ['thread-repos', threadId] });
  }
}
