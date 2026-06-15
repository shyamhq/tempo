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
  failedReason,
}: {
  status: SessionStatus;
  agentPresent: boolean | null;
  failedReason?: string | null;
}) {
  const effective: SessionStatus =
    status === 'connected' && agentPresent === false ? 'disconnected' : status;
  let tone: 'success' | 'accent' | 'muted';
  let dot: string;
  if (effective === 'connected') {
    tone = 'success';
    dot = 'bg-success';
  } else if (effective === 'pending' || effective === 'initiating') {
    tone = 'accent';
    dot = 'bg-accent animate-pulse';
  } else if (effective === 'failed') {
    tone = 'muted';
    dot = 'bg-danger';
  } else {
    tone = 'muted';
    dot = 'bg-ink-tertiary';
  }
  const title = effective === 'failed' ? (failedReason ?? 'Unknown error') : undefined;
  return (
    <Badge tone={tone} title={title}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      Session {effective}
    </Badge>
  );
}
