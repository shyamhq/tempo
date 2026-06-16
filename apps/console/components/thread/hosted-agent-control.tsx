'use client';

import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionStatus } from '@tempo/contracts';
import { Check, ExternalLink, Loader2, Play, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, workerApi } from '@/lib/api-client';

// Hosted-runtime control next to the Connect button. Three roles:
//   1. "Run Hosted Agent" button when no Sandbox is alive (wake + backfill).
//   2. State badge during Provisioning / Connected / Failed.
//   3. Tier 1 VM card with sandbox_id + relative age + Inspect-in-E2B link
//      when a Sandbox is live.
// Hides entirely when Hosted is off for the workspace or a Local CLI is
// connected (presence wins; supervisor short-circuits on isFresh anyway).
export function HostedAgentControl({
  threadId,
  sessionStatus,
  cliConnected,
}: {
  threadId: string;
  sessionStatus: SessionStatus;
  cliConnected: boolean;
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
  });

  const [hostedOff, setHostedOff] = useState(false);
  const wake = useMutation({
    mutationFn: () => wApi.wakeHosted(threadId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hosted-state', threadId] });
      if (res.status === 'hosted_off') {
        setHostedOff(true);
        setTimeout(() => setHostedOff(false), 2500);
      }
    },
  });

  if (!state.data?.hosted_enabled || cliConnected) return null;

  if (state.data.vm && sessionStatus === 'connected') {
    return (
      <div className="flex items-center gap-2 text-caption text-ink-subtle">
        <span className="font-mono">sandbox {state.data.vm.sandbox_id.slice(0, 12)}…</span>
        <span>· {relativeTime(state.data.vm.started_at)}</span>
        <a
          href={`https://e2b.dev/dashboard/sandbox/${state.data.vm.sandbox_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink hover:underline inline-flex items-center gap-1"
        >
          Inspect <ExternalLink className="h-3 w-3" />
        </a>
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

  if (hostedOff) {
    return (
      <Button variant="secondary" size="sm" disabled>
        <Check className="h-3.5 w-3.5" />
        Hosted disabled
      </Button>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => wake.mutate()} disabled={wake.isPending}>
      <Play className="h-3.5 w-3.5" />
      {wake.isPending ? 'Waking…' : 'Run Hosted Agent'}
    </Button>
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
