// The SSE event gateway: ONE subscribeToEvents() per active thread, the single
// writer of remote thread state into useThreadStore. Every frame enters here and
// is fanned out by kind + entity id into the feature slices. This is the
// centralized reactive mechanism — components never touch the stream, fetch, or
// Zod; they read selectors and call slice actions.
//
// Restructured from apps/console/hooks/use-thread-events.ts: the proven routing
// (SSE-only frame pre-guard → exhaustive Event switch → per-turn chunk
// assembler) is preserved verbatim in behavior; only the sink changed — it writes
// useThreadStore slice actions instead of the TanStack Query cache, and the
// React lifecycle moved out to hooks/useThreadSession.ts (T2.3 wiring).
//
// Reconnect correctness carried over: getToken() runs on EVERY (re)connect so a
// mid-session Clerk expiry can't permanently 401 the stream; Last-Event-ID
// replay is handled by the eventsource transport (no cursor param); and the
// MAXLEN-trim backstop fires onResyncNeeded only when a reconnect (not the first
// open) outlived the Redis stream window.

import { stripEmptyAgentText } from '@tempo/contracts';
import type {
  AgentChunkFrame,
  TempoUIMessage,
  UIMessageChunk,
} from '@tempo/contracts/agent-message';
import { Event, PresenceSignal, VmSignal } from '@tempo/contracts/events';
import { type SseSubscription, subscribeToEvents } from '@tempo/sse-client';
import { readUIMessageStream } from 'ai';
import { useThreadStore } from '../store';

// SEAM (T2.3): this mirrors apps/console's lib/api-client.ts workerEventsUrl.
// When console-redo gains its own lib/api-client.ts (T2.3 hydration), move
// WORKER_URL + this builder there and import it. Kept inline now so T2.2 is
// self-contained. No cursor param — Last-Event-ID drives the resume.
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:3001';
function workerEventsUrl(threadId: string): string {
  return `${WORKER_URL}/api/threads/${threadId}/events`;
}

export interface EventGatewayOptions {
  threadId: string;
  // Fresh Clerk JWT, awaited on every (re)connect. Never cache the result.
  getToken: () => Promise<string | null>;
  // The current Clerk user id, read per-frame. Human-originated events
  // (comment_resolved, plan_edited_by_dev) carry no actor on the wire — the
  // gateway supplies it from the connected Dev. A getter (not a value) so a user
  // change doesn't force a re-subscribe.
  actorUserId: () => string | null;
  // The MAXLEN-trim backstop + post-drop re-seed. Invoked when a reconnect
  // (after a drop that may have outlived Redis retention) lands, so T2.3 can
  // re-run the hydration fetch. Not called on the first open (the in-window case
  // is covered by Last-Event-ID replay).
  onResyncNeeded: () => void;
  // A finished agent turn: persisted agent messages should refetch (the merge
  // dedups the live turn by id). Wired in T2.3; the live stream is finalized
  // here regardless.
  onAgentTurnEnded?: () => void;
}

export interface EventGateway {
  close(): void;
}

export function openEventGateway(opts: EventGatewayOptions): EventGateway {
  const { threadId } = opts;
  const { setLiveMessage, clearLiveMessage } = useThreadStore.getState();

  // Live chunk-stream bridge. One live turn streams at a time (the producer holds
  // a per-thread turn lock), so a single ReadableStream controller suffices:
  // agent_chunk frames enqueue here and readUIMessageStream assembles successive
  // UIMessage snapshots into the agent slice.
  let liveTurn: {
    turn: string;
    controller: ReadableStreamDefaultController<UIMessageChunk>;
  } | null = null;

  const closeLiveTurn = () => {
    if (!liveTurn) return;
    try {
      liveTurn.controller.close();
    } catch {
      /* already closed */
    }
    liveTurn = null;
  };

  const sub: SseSubscription = subscribeToEvents({
    url: workerEventsUrl(threadId),
    getToken: async () => (await opts.getToken()) ?? '',
    onOpen: (reconnected) => {
      // MAXLEN-trim backstop: if the drop outlived the Redis stream window,
      // Last-Event-ID can't replay it — re-seed from the server. The normal
      // (in-window) case is covered by the replay, so the first open skips this.
      if (reconnected) opts.onResyncNeeded();
    },
    onMessage: (data) => {
      // agent_chunk is an SSE-only frame (NOT in the Event union). Bridge the
      // chunk into a per-turn ReadableStream so readUIMessageStream assembles a
      // live UIMessage snapshot written directly to the agent slice.
      if (
        data !== null &&
        typeof data === 'object' &&
        (data as Record<string, unknown>).kind === 'agent_chunk'
      ) {
        const { turn, chunk } = data as AgentChunkFrame;
        if (liveTurn?.turn !== turn) {
          closeLiveTurn(); // a new turn id replaces any prior live stream
          let ctrl!: ReadableStreamDefaultController<UIMessageChunk>;
          const stream = new ReadableStream<UIMessageChunk>({
            start(c) {
              ctrl = c;
            },
          });
          liveTurn = { turn, controller: ctrl };
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
        liveTurn?.controller.enqueue(chunk);
        return;
      }

      // presence is an SSE-only signal (NOT in the Event union) — pre-guarded
      // here so it isn't dropped by the Event parse below.
      const presence = PresenceSignal.safeParse(data);
      if (presence.success) {
        useThreadStore.getState().applyPresence(presence.data);
        return;
      }
      // vm is an SSE-only signal (NOT in the Event union) — the VM provisioning
      // lifecycle. Patched onto the thread slice exactly like presence above.
      const vm = VmSignal.safeParse(data);
      if (vm.success) {
        useThreadStore.getState().applyVm(vm.data);
        return;
      }

      // The gateway is the trust boundary: validate every persisted frame before
      // it reaches a slice. Malformed frames are dropped (as the transport does
      // for unparseable JSON).
      const parsed = Event.safeParse(data);
      if (!parsed.success) return;
      dispatch(parsed.data, opts, closeLiveTurn);
    },
  });

  return {
    close() {
      sub.close();
      closeLiveTurn();
      clearLiveMessage(threadId);
    },
  };
}

// Fan one validated Event into the slices. A single exhaustive switch over the
// discriminated union — the `default: never` makes the compiler reject any new
// EventKind that isn't handled here (no reducer table to drift out of sync).
// Several kinds intentionally write no slice (agent_cancel_requested is handled
// in-Turn server-side; agent_turn_ended only finalizes the live stream).
function dispatch(event: Event, opts: EventGatewayOptions, closeLiveTurn: () => void): void {
  const store = useThreadStore.getState();
  switch (event.kind) {
    case 'comment_added':
      store.applyCommentAdded(event);
      return;
    case 'reply_added':
      store.applyReplyAdded(event);
      return;
    case 'comment_resolved':
      // The wire frame carries no actor — supply the connected Dev. Never null
      // for a human-originated resolve.
      store.applyCommentResolved(event, opts.actorUserId());
      return;
    case 'comment_unresolved':
      store.applyCommentUnresolved(event);
      return;
    case 'comment_deleted':
      store.applyCommentDeleted(event);
      return;
    case 'plan_edited_by_dev':
    case 'plan_edited_by_agent':
      // Bump plan meta. The slice supplies updated_by from the actor for a Dev
      // edit and forces null for an agent edit (it discriminates on event.kind).
      // The canonical plan body arrives on the refetch T2.3 wires.
      store.applyPlanEdited(event, opts.actorUserId());
      return;
    case 'discussion_message_posted':
      store.applyDiscussionMessagePosted(event);
      return;
    case 'thread_renamed':
      // Fan to BOTH the thread meta (header title) and the sidebar tree (rail
      // title) — two independent slices, one rename.
      store.applyThreadRenamed(event);
      store.applyThreadRenamedInTree(event, opts.threadId);
      return;
    case 'repo_linked':
      store.applyRepoLinked(event);
      return;
    case 'agent_turn_ended':
      // The live stream closes and the persisted UIMessage carries the same turn
      // id — refetching lets the merge dedup the live slot away (gapless, no
      // timer). The live slot is overwritten on the next turn.
      closeLiveTurn();
      opts.onAgentTurnEnded?.();
      return;
    case 'agent_cancel_requested':
      // No slice write — Stop is handled in-Turn server-side (mirrors the old
      // hook, which also ignored it on the browser).
      return;
    default: {
      // Compile-time exhaustiveness: a new EventKind that isn't handled above
      // makes this assignment fail to typecheck.
      const _exhaustive: never = event;
      void _exhaustive;
      return;
    }
  }
}
