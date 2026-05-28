'use client';

import { Badge } from '@/components/ui/badge';
import type { ActivityStatus, SessionStatus } from '@tempo/contracts';

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

export function ActivityPill({ activity }: { activity: ActivityStatus | null }) {
  if (!activity) return null;
  return (
    <Badge tone="neutral">
      <span className="text-ink-subtle">{activity.label}</span>
      {activity.detail ? (
        <span className="text-ink-tertiary truncate max-w-[20rem]">
          — {activity.detail}
        </span>
      ) : null}
    </Badge>
  );
}
