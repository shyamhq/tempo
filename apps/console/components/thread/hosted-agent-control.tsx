'use client';

import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentType, SessionStatus } from '@tempo/contracts';
import { Loader2, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { api, workerApi } from '@/lib/api-client';

// Hosted-runtime status surface next to the Connect button. Renders only for
// Hosted Threads. Auto-wake fires server-side on Dev wake events; this
// component only shows state and offers a Try again escape hatch on failure.
//   1. Provisioning badge during initiating.
//   2. Try again button on failed (recovery when auto-wake didn't fire).
//   3. Tier 1 VM card with sandbox_id + relative age when a Sandbox is live.
export function HostedAgentControl({
  threadId,
  agentType,
  sessionStatus,
}: {
  threadId: string;
  agentType: AgentType;
  sessionStatus: SessionStatus;
}) {
  const { getToken } = useAuth();
  const wApi = useMemo(() => workerApi(getToken), [getToken]);
  const qc = useQueryClient();
  // Poll fast while booting (vm row appears within a couple of seconds),
  // slower while connected (catches idle reap), idle otherwise.
  let refetchInterval: number | false = false;
  if (sessionStatus === 'initiating') refetchInterval = 2000;
  else if (sessionStatus === 'connected') refetchInterval = 5000;

  const state = useQuery({
    queryKey: ['hosted-state', threadId],
    queryFn: () => api.getHostedState(threadId),
    refetchInterval,
    enabled: agentType === 'hosted',
  });

  const wake = useMutation({
    mutationFn: () => wApi.wakeHosted(threadId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosted-state', threadId] }),
  });

  if (agentType !== 'hosted') return null;

  if (state.data?.vm && sessionStatus === 'connected') {
    return (
      <div className="flex items-center gap-2 text-caption text-ink-subtle">
        <span className="font-mono">sandbox {state.data.vm.sandbox_id.slice(0, 12)}…</span>
        <span>· {relativeTime(state.data.vm.started_at)}</span>
      </div>
    );
  }

  if (sessionStatus === 'initiating') {
    return (
      <Button variant="secondary" size="sm" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Provisioning sandbox…
      </Button>
    );
  }

  if (sessionStatus === 'failed') {
    return (
      <Button variant="secondary" size="sm" onClick={() => wake.mutate()} disabled={wake.isPending}>
        <RotateCcw className="h-3.5 w-3.5" />
        Try again
      </Button>
    );
  }

  return null;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
