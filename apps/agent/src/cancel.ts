import type { Event, SessionId } from '@tempo/contracts';

export const CANCEL_NOTICE =
  'Cancelled by Dev. Anything already in the Plan stayed; anything in flight was lost.';

// Returns the first cancel event addressed to this CLI's session, or null.
// Stale cancels targeting a prior session on the same Thread are ignored.
export function findCancelForSession(events: Event[], sessionId: SessionId): Event | null {
  for (const ev of events) {
    if (ev.kind === 'agent_cancel_requested' && ev.session_id === sessionId) return ev;
  }
  return null;
}
