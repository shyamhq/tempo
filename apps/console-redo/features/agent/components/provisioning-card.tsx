'use client';

// The Hosted-VM provisioning card — the agent's startup sequence (set up
// container → clone repo → start the agent), so it lives in the agent feature.
// Rendered in two places: the top of the discussion log (provisioning happens at
// thread start) AND the agent activity drawer (where the Dev watches agent
// activity once the Plan is drafted). Three steps, derived from the live `vm` SSE
// state + agent presence:
//
//   - "Set up a cloud container" — active while phase=provisioning; done once a
//     sandbox_id exists (phase advances to cloning) or the agent is live.
//   - "Cloned repository"        — active while phase=cloning; done when the agent
//     connects (there is no `done` phase — agent presence IS the ready signal).
//   - "Started the agent"        — done when the agent is live.
//
// A `failed` phase marks the step it died on (no sandbox → container; sandbox set
// → clone) red with the sanitized reason. Once everything is done (agent live) the
// card auto-collapses to a one-line "Initialized session" summary the Dev can
// re-expand. Hosted only — Local threads have no VM, so this renders nothing.

import type { VmState } from '@tempo/contracts';
import { AlertCircle, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAgentPresent, useAgentType, useVm } from '@/store';

type Status = 'pending' | 'active' | 'done' | 'failed';
type Step = { label: string; status: Status };

const STATUS_CLASS: Record<Status, string> = {
  done: 'text-ink-2',
  active: 'font-medium text-ink',
  failed: 'font-medium text-danger',
  pending: 'text-ink-3',
};

function provisioningSteps(vm: VmState | null, agentPresent: boolean): Step[] {
  const phase = vm?.phase ?? null;
  const hasSandbox = Boolean(vm?.sandbox_id);

  // `cloning` implies sandbox_id is set, so `hasSandbox` already covers it.
  const container: Status =
    agentPresent || hasSandbox ? 'done' : phase === 'failed' ? 'failed' : 'active';

  const clone: Status = agentPresent
    ? 'done'
    : phase === 'failed' && hasSandbox
      ? 'failed'
      : phase === 'cloning'
        ? 'active'
        : 'pending';

  // `clone === 'done'` only when `agentPresent` is true — no intermediate signal
  // exists between cloning-complete and agent-connected, so `active` is unreachable.
  const agent: Status = agentPresent ? 'done' : 'pending';

  return [
    { label: 'Set up a cloud container', status: container },
    { label: 'Cloned repository', status: clone },
    { label: 'Started the agent', status: agent },
  ];
}

export function ProvisioningCard() {
  const agentType = useAgentType();
  const vm = useVm();
  const agentPresent = useAgentPresent();

  // Manual toggle overrides the default (open while provisioning, collapsed once
  // done) without an effect: `open ?? !done`.
  const [open, setOpen] = useState<boolean | null>(null);

  // Hosted only, and only once there's something to report (a live VM frame, or
  // the agent already up). Local threads / not-yet-spawned hosted threads: nothing.
  if (agentType !== 'hosted' || (vm === null && !agentPresent)) return null;

  const failed = vm?.phase === 'failed';
  const done = agentPresent && !failed;
  const expanded = open ?? !done;
  const steps = provisioningSteps(vm, agentPresent);

  const headline = failed
    ? 'Sandbox setup failed'
    : done
      ? 'Initialized session'
      : 'Setting up the sandbox…';

  return (
    <div className="mx-4 mb-1 mt-3 overflow-hidden rounded-[11px] border border-border bg-canvas">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-inset"
      >
        {failed ? (
          <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden />
        ) : done ? (
          <Check className="size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
        )}
        <span
          className={`flex-1 text-[12.5px] font-semibold ${failed ? 'text-danger' : 'text-ink'}`}
        >
          {headline}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-ink-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded ? (
        <ul className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
          {steps.map((step) => (
            <StepRow key={step.label} step={step} reason={vm?.reason} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StepRow({ step, reason }: { step: Step; reason: string | undefined }) {
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      <StepIcon status={step.status} />
      <span className="flex min-w-0 flex-col">
        <span className={STATUS_CLASS[step.status]}>{step.label}</span>
        {step.status === 'failed' && reason ? (
          <span className="break-words text-[11.5px] leading-[1.45] text-ink-3">{reason}</span>
        ) : null}
      </span>
    </li>
  );
}

function StepIcon({ status }: { status: Status }) {
  if (status === 'done') {
    return (
      <span className="mt-px flex size-[15px] shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Check className="size-2.5" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (status === 'active') {
    return <Loader2 className="mt-px size-[15px] shrink-0 animate-spin text-primary" aria-hidden />;
  }
  if (status === 'failed') {
    return <AlertCircle className="mt-px size-[15px] shrink-0 text-danger" aria-hidden />;
  }
  return (
    <span
      className="mt-[3px] size-[11px] shrink-0 rounded-full border-[1.5px] border-border"
      aria-hidden
    />
  );
}
