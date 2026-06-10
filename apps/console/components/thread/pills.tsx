'use client';

import type { SessionStatus } from '@tempo/contracts';
import { Badge } from '@/components/ui/badge';

// `agentPresent` derives from the SSE `presence` frame (server-side
// last_seen_at check). null = unknown/initial — defer to status. false on a
// connected status means heartbeat went stale; render the same as
// disconnected so the Dev sees a single "agent is gone" UX.
export function SessionPill({
  status,
  agentPresent,
}: {
  status: SessionStatus;
  agentPresent: boolean | null;
}) {
  const effective: SessionStatus =
    status === 'connected' && agentPresent === false ? 'disconnected' : status;
  const tone = effective === 'connected' ? 'success' : effective === 'pending' ? 'accent' : 'muted';
  const dot =
    effective === 'connected'
      ? 'bg-success'
      : effective === 'pending'
        ? 'bg-accent animate-pulse'
        : 'bg-ink-tertiary';
  return (
    <Badge tone={tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      Session {effective}
    </Badge>
  );
}
