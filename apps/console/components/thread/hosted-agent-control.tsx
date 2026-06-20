'use client';

import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { VmState } from '@tempo/contracts';
import { CheckCircle2, ChevronDown, Circle, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';

// The two provisioning phases the VM actually reports (Tempo vocabulary — no
// "session" or "Claude Code"). There is no third "Start Agent" step: the runner
// connects its SSE before it would report "started", so agent presence IS the
// done signal — at which point the parent swaps this checklist for the sandbox
// line.
const STEPS = [
  { key: 'provision', label: 'Provision sandbox' },
  { key: 'clone', label: 'Clone repository' },
] as const;

// Hosted-runtime status surface next to the Connect button. Renders only for
// Hosted Threads with a live VM. Both `vm` (provisioning lifecycle) and
// `agentPresent` (Redis presence) ride the thread view — hydrated on load and
// pushed live by the `vm` / `presence` SSE frames. No polling.
//   - vm null      → render nothing (no Sandbox; auto-wake will spawn one)
//   - agentPresent → sandbox id + age (the runner connected = provisioning done)
//   - else         → provisioning checklist popover (provisioning / cloning / failed)
export function HostedAgentControl({
  agentPresent,
  vm,
}: {
  agentPresent: boolean;
  vm: VmState | null;
}) {
  if (!vm) return null;

  if (agentPresent) {
    return (
      <div className="flex items-center gap-2 text-caption text-ink-subtle">
        <span className="font-mono">sandbox {vm.sandbox_id?.slice(0, 12) ?? '—'}…</span>
        <span>· {relativeTime(vm.started_at)}</span>
      </div>
    );
  }

  return <ProvisioningStatus vm={vm} />;
}

type StepState = 'done' | 'current' | 'pending' | 'failed';

const STEP_TEXT_CLASS: Record<StepState, string> = {
  done: 'text-body-sm text-ink',
  current: 'text-body-sm text-ink',
  pending: 'text-body-sm text-ink-tertiary',
  failed: 'text-body-sm text-danger',
};

// The phase maps to the in-flight step: provisioning → step 0, cloning → step 1.
// On failure the in-flight step is derived the same way (no sandbox yet → it
// failed at provisioning; sandbox up → it failed at cloning).
function activeStep(vm: VmState): number {
  if (vm.phase === 'cloning') return 1;
  if (vm.phase === 'failed') return vm.sandbox_id ? 1 : 0;
  return 0; // provisioning
}

// A compact header trigger that opens the checklist popover. The trigger stays
// on the cramped 56px header line; the step-by-step checklist lives in the
// popover, which opens by default while a VM provisions and the Dev can toggle.
// This component only mounts while !agentPresent (the parent shows the sandbox
// line once the runner connects), so there is no "all done" collapse to handle.
function ProvisioningStatus({ vm }: { vm: VmState }) {
  const failed = vm.phase === 'failed';
  const active = activeStep(vm);

  const [open, setOpen] = useState(true);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  const stepStateAt = (i: number): StepState => {
    if (i < active) return 'done';
    if (i > active) return 'pending';
    return failed ? 'failed' : 'current';
  };

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-expanded={open}
        {...getReferenceProps()}
        className="inline-flex items-center gap-1.5 text-caption"
      >
        {failed ? (
          <XCircle className="size-icon-xs shrink-0 text-danger" />
        ) : (
          <Loader2 className="size-icon-xs shrink-0 animate-spin text-accent" />
        )}
        <span className={failed ? 'text-danger' : 'text-ink-muted'}>
          {failed ? 'Provisioning failed' : 'Provisioning sandbox'}
        </span>
        <ChevronDown
          className={`size-icon-xs text-ink-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-30 w-72 rounded-lg border border-hairline bg-canvas p-3 shadow-card"
          >
            <div className="mb-2 text-caption-bold text-ink">Provisioning sandbox</div>
            <ul className="flex flex-col gap-2">
              {STEPS.map((step, i) => {
                const st = stepStateAt(i);
                return (
                  <li key={step.key} className="flex items-center gap-2">
                    <StepIcon state={st} />
                    <span className={STEP_TEXT_CLASS[st]}>{step.label}</span>
                  </li>
                );
              })}
            </ul>
            {failed ? (
              vm.reason ? (
                <p className="mt-2 border-t border-hairline pt-2 text-caption text-danger">
                  {vm.reason}
                </p>
              ) : null
            ) : (
              <p className="mt-2 text-caption text-ink-subtle">This usually takes a few seconds.</p>
            )}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircle2 className="size-icon-sm shrink-0 text-success" />;
  if (state === 'current')
    return <Loader2 className="size-icon-sm shrink-0 animate-spin text-accent" />;
  if (state === 'failed') return <XCircle className="size-icon-sm shrink-0 text-danger" />;
  return <Circle className="size-icon-sm shrink-0 text-ink-tertiary" />;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
