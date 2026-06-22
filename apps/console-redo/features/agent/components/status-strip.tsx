'use client';

// The bottom status strip (kit `.strip`, workbench index.html lines 205-208,
// 494-506): presence on the left, an activity chip summarizing the latest agent
// turn (opens the activity drawer), and the VM provisioning pill on the right.
//
// It lives in the agent feature because its job is summarizing agent activity
// (presence, the latest turn, turn-live). The VM pill is the one non-agent bit,
// read through the shared store selector.
//
// Presentational: it reads presence / agent messages / vm via store selectors
// and toggles the drawer via a store action. The kit's "· Local CLI" presence
// suffix and "Slice 3/6" / "Draft" right-side items are demo-only — there is no
// connection-kind or plan-status fact in the slices, so they are omitted rather
// than fabricated (agent brief §5: fix/render the invariant, never invent data).

import type { VmState } from '@tempo/contracts';
import { ChevronUp, Server } from 'lucide-react';
import {
  useAgentMessages,
  useAgentPresent,
  useAgentTurnLive,
  useAgentType,
  useThreadStore,
  useVm,
} from '@/store';
import { summarizeActivity } from '../activity';

// The VM pill for a Hosted thread. While the sandbox provisions it shows the live
// phase; once the agent is live (the "done" signal — there is no `done` phase)
// it settles to a steady "VM sandbox" so the Dev always knows the agent runs in a
// VM, instead of sticking on "Cloning repo" forever (the old bug). Local threads
// have no VM, so this is null for them.
type VmPill = { label: string; tone: 'primary' | 'warning' | 'danger' | 'muted' };

function vmPillFor(
  agentType: string | null,
  vm: VmState | null,
  agentPresent: boolean,
): VmPill | null {
  if (agentType !== 'hosted') return null;
  if (vm?.phase === 'failed') return { label: 'VM failed', tone: 'danger' };
  if (vm && !agentPresent) {
    return vm.phase === 'provisioning'
      ? { label: 'Provisioning VM', tone: 'primary' }
      : { label: 'Cloning repo', tone: 'warning' };
  }
  // No VM frame yet and the agent isn't up — nothing is running (a hosted thread
  // before its first spawn, or an idle one). The "Agent idle" indicator covers
  // that; don't claim a sandbox exists. The steady pill is for when it actually does.
  if (vm === null && !agentPresent) return null;
  return { label: 'VM sandbox', tone: 'muted' };
}

const PILL_TONE: Record<VmPill['tone'], string> = {
  primary: 'text-primary',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-ink-3',
};

// `muted` is the settled state — show a Server icon instead of a pulsing dot.
// For the three active tones, map directly to a dot background class.
const DOT_BG: Partial<Record<VmPill['tone'], string>> = {
  primary: 'tp-pulse bg-primary',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function StatusStrip({ threadId }: { threadId: string }) {
  const agentPresent = useAgentPresent();
  const messages = useAgentMessages(threadId);
  const turnLive = useAgentTurnLive(threadId);
  const vm = useVm();
  const agentType = useAgentType();
  const setActivityOpen = useThreadStore((s) => s.setActivityOpen);

  const latest = messages.at(-1);
  const summary = latest ? summarizeActivity(latest, turnLive) : null;
  const vmPill = vmPillFor(agentType, vm, agentPresent);

  return (
    <div className="flex h-[30px] shrink-0 items-center gap-4 border-t border-border bg-canvas px-[14px] text-[11.5px] text-ink-2">
      <span className="inline-flex items-center gap-[7px]">
        <span
          className={`size-[7px] shrink-0 rounded-full ${
            agentPresent ? 'tp-pulse bg-[var(--tp-success)]' : 'bg-ink-3'
          }`}
          aria-hidden
        />
        {agentPresent ? 'Agent live' : 'Agent idle'}
      </span>

      {summary ? (
        <button
          type="button"
          title="Open agent activity"
          onClick={() => setActivityOpen(true)}
          className="inline-flex h-[23px] items-center gap-2 rounded-[7px] border border-transparent pl-[9px] pr-[7px] text-[11.5px] text-ink-2 outline-none transition-colors hover:border-border hover:bg-canvas focus-visible:shadow-[var(--tp-focus-ring)]"
        >
          <span
            className={`box-border size-[11px] shrink-0 rounded-full border-[2.5px] ${
              summary.live ? 'tp-ring-pulse border-primary' : 'border-ink-3'
            }`}
            aria-hidden
          />
          <span className="font-semibold text-ink">{summary.verb}</span>
          {summary.file ? (
            <span className="max-w-[160px] truncate text-[11px] text-ink-3">{summary.file}</span>
          ) : null}
          {summary.badge > 0 ? (
            <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-white">
              {summary.badge}
            </span>
          ) : null}
          <ChevronUp className="size-[13px] text-ink-3" aria-hidden />
        </button>
      ) : null}

      <div className="flex-1" />

      {vmPill ? (
        <span className={`inline-flex items-center gap-1.5 ${PILL_TONE[vmPill.tone]}`}>
          {vmPill.tone === 'muted' ? (
            <Server className="size-[12px] shrink-0" strokeWidth={2} aria-hidden />
          ) : (
            <span
              className={`size-[7px] shrink-0 rounded-full ${DOT_BG[vmPill.tone]}`}
              aria-hidden
            />
          )}
          <span className="font-mono">{vmPill.label}</span>
        </span>
      ) : null}
    </div>
  );
}
