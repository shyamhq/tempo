'use client';

// The React lifecycle glue around the event gateway: for a threadId, open ONE
// gateway on mount and tear it down on unmount. This is the only place the
// gateway touches React — the gateway itself (lib/event-gateway.ts) is
// framework-agnostic.
//
// Clerk auth is read here and handed to the gateway: getToken (awaited fresh on
// every reconnect) and the current user id (the actor the wire frames omit). Both
// are kept in refs so a new token/user identity doesn't re-subscribe the stream —
// the effect deps stay [threadId] so the gateway opens exactly once per thread.

import { useAuth, useUser } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import { openEventGateway } from '../lib/event-gateway';

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

    const gateway = openEventGateway({
      threadId,
      getToken: () => getTokenRef.current(),
      actorUserId: () => userIdRef.current,
      // SEAM (T2.3): re-run the hydration fetch to re-seed the slices after a
      // drop that may have outlived Redis retention. T2.3 adds the hydration
      // helper and passes it here; until then a reconnect after a long gap
      // relies solely on Last-Event-ID replay (in-window) — no heal-on-mount.
      onResyncNeeded: () => {},
      // SEAM (T2.3): refetch persisted agent messages so the merge dedups the
      // just-finished live turn by id. The gateway already finalizes the live
      // stream on agent_turn_ended; this only triggers the persisted pull.
      onAgentTurnEnded: () => {},
    });

    return () => gateway.close();
  }, [threadId]);
}
