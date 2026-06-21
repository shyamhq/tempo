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
import { ChevronUp } from 'lucide-react';
import {
  useAgentMessages,
  useAgentPresent,
  useAgentTurnLive,
  useThreadStore,
  useVm,
} from '@/store';
import { summarizeActivity } from '../activity';

const VM_PHASE_LABEL: Record<VmState['phase'], string> = {
  provisioning: 'Provisioning VM',
  cloning: 'Cloning repo',
  failed: 'VM failed',
};

export function StatusStrip({ threadId }: { threadId: string }) {
  const agentPresent = useAgentPresent();
  const messages = useAgentMessages(threadId);
  const turnLive = useAgentTurnLive(threadId);
  const vm = useVm();
  const setActivityOpen = useThreadStore((s) => s.setActivityOpen);

  const latest = messages.at(-1);
  const summary = latest ? summarizeActivity(latest, turnLive) : null;

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

      {vm ? (
        <span
          className={`inline-flex items-center gap-1.5 ${
            vm.phase === 'failed' ? 'text-danger' : vm.phase === 'cloning' ? 'text-warning' : ''
          }`}
        >
          <span
            className={`size-[7px] shrink-0 rounded-full ${
              vm.phase === 'failed'
                ? 'bg-danger'
                : vm.phase === 'cloning'
                  ? 'bg-warning'
                  : 'tp-pulse bg-primary'
            }`}
            aria-hidden
          />
          <span className="font-mono">{VM_PHASE_LABEL[vm.phase]}</span>
        </span>
      ) : null}
    </div>
  );
}
