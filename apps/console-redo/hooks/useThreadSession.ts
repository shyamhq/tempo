'use client';

// The React lifecycle glue around the event gateway: for a threadId, hydrate the
// slices then open ONE gateway on mount, and tear it down on unmount. This is the
// only place the gateway touches React — the gateway itself
// (lib/event-gateway.ts) is framework-agnostic.
//
// Clerk auth is read here and handed to the gateway: getToken (awaited fresh on
// every reconnect) and the current user id (the actor the wire frames omit). Both
// are kept in refs so a new token/user identity doesn't re-subscribe the stream —
// the effect deps stay [threadId] so the gateway opens exactly once per thread.

import { useAuth, useUser } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import { getPersistedMessages } from '../features/agent/api';
import { type EventGateway, openEventGateway } from '../lib/event-gateway';
import { useThreadStore } from '../store';
import { hydrateThread } from './hydrateThread';

function logHydrateError(e: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('useThreadSession: hydrate/refetch failed', e);
  }
}

export function useThreadSession(threadId: string): void {
  const { getToken } = useAuth();
  const { user } = useUser();

  // Latest-refs so the gateway closures read current auth without the effect
  // depending on getToken/user (which change identity across renders).
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  useEffect(() => {
    if (!threadId) return;

    let cancelled = false;
    let gateway: EventGateway | null = null;

    // Hydrate FIRST, then open the gateway as the only writer of remote thread
    // state. Opening before the seed lands would let an in-gap event apply to an
    // empty slice, which the trailing setComments would then overwrite — dropping
    // that event. (A failed hydrate surfaces via the log; the retry/error UI is a
    // later task — for now the gateway simply doesn't open on a broken thread.)
    hydrateThread(threadId)
      .then(() => {
        if (cancelled) return;
        gateway = openEventGateway({
          threadId,
          getToken: () => getTokenRef.current(),
          actorUserId: () => userIdRef.current,
          // A reconnect after a drop that may have outlived Redis retention:
          // re-seed from the server (Last-Event-ID can't replay a trimmed window).
          onResyncNeeded: () => {
            void hydrateThread(threadId).catch(logHydrateError);
          },
          // A finished agent turn: refetch persisted messages so the merge dedups
          // the just-finished live turn by id (the gateway already finalized the
          // live stream on agent_turn_ended).
          onAgentTurnEnded: () => {
            void getPersistedMessages(threadId)
              .then((messages) =>
                useThreadStore.getState().setPersistedMessages(threadId, messages),
              )
              .catch(logHydrateError);
          },
        });
      })
      .catch(logHydrateError);

    return () => {
      cancelled = true;
      gateway?.close();
    };
  }, [threadId]);
}
