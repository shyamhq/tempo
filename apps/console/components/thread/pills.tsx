'use client';

import type { SessionStatus } from '@tempo/contracts';
import { Badge } from '@/components/ui/badge';

export function SessionPill({ status }: { status: SessionStatus }) {
  const tone = status === 'connected' ? 'success' : status === 'pending' ? 'accent' : 'muted';
  const dot =
    status === 'connected'
      ? 'bg-success'
      : status === 'pending'
        ? 'bg-accent animate-pulse'
        : 'bg-ink-tertiary';
  return (
    <Badge tone={tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      Session {status}
    </Badge>
  );
}
