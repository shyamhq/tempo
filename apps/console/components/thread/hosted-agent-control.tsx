'use client';

import { useQuery } from '@tanstack/react-query';
import type { AgentType } from '@tempo/contracts';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { type ProvisioningStep, useProvisioningState } from '@/hooks/use-thread-events';
import { api } from '@/lib/api-client';

// Ordered provisioning steps and their display labels (Tempo vocabulary —
// no "session" or "Claude Code").
const STEP_ORDER = ['sandbox_ready', 'repos_cloned', 'agent_started'] as const;
type MainStep = (typeof STEP_ORDER)[number];

const STEP_LABELS: Record<MainStep, string> = {
  sandbox_ready: 'Set up sandbox',
  repos_cloned: 'Cloned repositories',
  agent_started: 'Agent started',
};

// Hosted-runtime status surface next to the Connect button. Renders only for
// Hosted Threads. Auto-wake fires server-side on Dev wake events; this
// component shows the VM lifecycle state — `vm_runs` for the Sandbox, the Redis
// presence key (`agentPresent`) for whether the runner is connected.
//   - vm null            → render nothing (no live Sandbox; auto-wake will fire)
//   - vm live, !present  → "Provisioning sandbox…" or step checklist
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
  const provisioning = useProvisioningState(threadId);

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

  // Show the step-by-step checklist when vm_progress events have arrived;
  // fall back to the generic spinner while waiting for the first step.
  if (provisioning.steps.length > 0) {
    return <ProvisioningChecklist steps={provisioning.steps} />;
  }

  return (
    <div className="inline-flex items-center gap-2 text-caption text-ink-subtle">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Provisioning sandbox…
    </div>
  );
}

// Compact inline checklist for the thread header. Each row is one provisioning
// step; the last step in the list is "running" (spinner), completed steps get
// a green check, pending steps are faint. `failed` shows a red × with the
// optional reason string.
function ProvisioningChecklist({ steps }: { steps: ProvisioningStep[] }) {
  const failedStep = steps.find((s) => s.step === 'failed');
  const completedKinds = new Set<MainStep>(
    steps
      .filter((s): s is ProvisioningStep & { step: MainStep } =>
        (STEP_ORDER as readonly string[]).includes(s.step),
      )
      .map((s) => s.step as MainStep),
  );
  const lastCompletedIndex = STEP_ORDER.reduce<number>(
    (acc, k, i) => (completedKinds.has(k) ? i : acc),
    -1,
  );
  const isRunning = !failedStep && lastCompletedIndex < STEP_ORDER.length - 1;

  return (
    <div className="flex flex-col gap-0.5 text-caption">
      {/* Summary line */}
      <div className="flex items-center gap-1.5 text-ink-subtle">
        {failedStep ? (
          <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
        ) : isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
        )}
        <span>
          {failedStep
            ? 'Provisioning failed'
            : isRunning
              ? `${completedKinds.size} / ${STEP_ORDER.length} steps`
              : 'Ready'}
        </span>
      </div>

      {/* Expanded step rows */}
      <div className="pl-5 flex flex-col gap-0.5">
        {STEP_ORDER.map((stepKind, i) => {
          const isDone = completedKinds.has(stepKind);
          // A step is actively running if it's the step after the last completed one.
          const isActive = !failedStep && !isDone && i === lastCompletedIndex + 1;
          return (
            <div
              key={stepKind}
              className={`flex items-center gap-1.5 ${
                isDone ? 'text-ink' : isActive ? 'text-ink-subtle' : 'text-ink-tertiary'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              ) : (
                <span className="h-3 w-3 flex items-center justify-center shrink-0" aria-hidden>
                  <span className="h-2 w-2 rounded-full border border-hairline-strong" />
                </span>
              )}
              <span>{STEP_LABELS[stepKind]}</span>
            </div>
          );
        })}

        {failedStep ? (
          <div className="flex items-start gap-1.5 text-danger">
            <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{failedStep.reason ?? 'Provisioning failed — try sending another message.'}</span>
          </div>
        ) : null}
      </div>
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
