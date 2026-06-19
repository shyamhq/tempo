'use client';

import { useQuery } from '@tanstack/react-query';
import type { AgentType } from '@tempo/contracts';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';

// Hosted-runtime status surface next to the Connect button. Renders only for
// Hosted Threads. Auto-wake fires server-side on Dev wake events; this
// component shows the VM lifecycle state — `vm_runs` for the Sandbox, the Redis
// presence key (`agentPresent`) for whether the runner is connected.
//   - vm null            → render nothing (no live Sandbox; auto-wake will fire)
//   - vm live, !present  → "Provisioning sandbox…"
//   - vm live, present   → sandbox id + age
export function HostedAgentControl({
  threadId,
  agentType,
  agentPresent,
}: {
  threadId: string;
  agentType: AgentType;
  agentPresent: boolean;
}) {
  const state = useQuery({
    queryKey: ['hosted-state', threadId],
    queryFn: () => api.getHostedState(threadId),
    refetchInterval: agentPresent ? 5000 : 2000,
    enabled: agentType === 'hosted',
  });

  if (agentType !== 'hosted') return null;
  if (!state.data?.vm) return null;

  if (agentPresent) {
    return (
      <div className="flex items-center gap-2 text-caption text-ink-subtle">
        <span className="font-mono">sandbox {state.data.vm.sandbox_id.slice(0, 12)}…</span>
        <span>· {relativeTime(state.data.vm.started_at)}</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 text-caption text-ink-subtle">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Provisioning sandbox…
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
