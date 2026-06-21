'use client';

// The agent-activity drawer (kit `.actpanel`, workbench index.html lines
// 249-273, 511-532): a right slide-in panel with a header (✦ tile + title + run
// sub-line + close), an honest stats row, a live/idle state line, an
// indeterminate progress bar while a turn streams, and the activity feed.
//
// Radix Dialog backs the scrim, focus-trap, ESC, and a11y — not hand-rolled. It
// is styled to the kit via data-state transforms on the Overlay/Content. The
// drawer's open flag lives in the UI slice (transient, not persisted); the
// StatusStrip's activity chip toggles it.

import * as Dialog from '@radix-ui/react-dialog';
import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import { X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import {
  useActivityOpen,
  useAgentMessages,
  useAgentPresent,
  useAgentTurnLive,
  useThreadStore,
} from '@/store';
import { countEdits, countTools } from '../activity';
import { ActivityFeed } from './activity-feed';

export function ActivityDrawer({ threadId }: { threadId: string }) {
  const open = useActivityOpen();
  const messages = useAgentMessages(threadId);
  const agentPresent = useAgentPresent();
  const live = useAgentTurnLive(threadId);
  const setActivityOpen = useThreadStore((s) => s.setActivityOpen);

  const latest = messages.at(-1);

  return (
    <Dialog.Root open={open} onOpenChange={setActivityOpen}>
      {/* No forceMount: Radix unmounts both surfaces on close. forceMount kept a
          stale inset-0 scrim in the DOM whose Radix-set inline pointer-events:auto
          (which a class can't override) swallowed every click on the plan. The
          entry slide/fade is a mount animation (the panel only exists while open). */}
      <Dialog.Portal>
        <Dialog.Overlay className="tp-fade-in fixed inset-0 z-[70] bg-[var(--tp-backdrop)]" />
        <Dialog.Content className="tp-slide-in-right fixed inset-y-0 right-0 z-[71] flex w-[436px] max-w-[92vw] flex-col border-l border-border bg-panel shadow-lg">
          <Dialog.Description className="sr-only">
            Agent activity timeline for this thread
          </Dialog.Description>
          <Header live={live} agentPresent={agentPresent} latest={latest} />
          {live ? <ProgressBar /> : null}
          <ActivityFeed messages={messages} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Header({
  live,
  agentPresent,
  latest,
}: {
  live: boolean;
  agentPresent: boolean;
  latest: TempoUIMessage | undefined;
}) {
  // The run sub-line shows a real, short turn id — not a fabricated "Run #142".
  const runLabel = latest ? `Turn ${latest.id.slice(-8)}` : 'No runs yet';
  const tools = latest ? countTools(latest) : 0;
  const edits = latest ? countEdits(latest) : 0;
  const stateText = live ? 'Running…' : latest ? 'Last run complete' : 'Idle';

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-border bg-canvas p-[14px_15px]">
      <div className="flex items-center gap-[10px]">
        {/* The sanctioned agent ✦-on-success-gradient lives in Avatar; reuse it
            here so the gradient (and its one fixed stop) is defined in one place.
            Override radius/font to the kit tile (27px → 7px radius, 13px glyph). */}
        <Avatar kind="agent" size={27} style={{ borderRadius: 7, fontSize: 13 }} aria-hidden />
        <div className="min-w-0">
          <Dialog.Title className="font-display text-[14px] font-semibold leading-[1.2] text-ink">
            Agent activity
          </Dialog.Title>
          <div className="mt-px truncate font-mono text-[11px] text-ink-3">{runLabel}</div>
        </div>
        <Dialog.Close
          aria-label="Close"
          className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-2 outline-none transition-colors hover:bg-inset focus-visible:shadow-[var(--tp-focus-ring)] [&_svg]:size-4"
        >
          <X aria-hidden />
        </Dialog.Close>
      </div>

      {/* Stats — only the ones derivable from the parts. Elapsed is omitted: the
          merged timeline carries no honest per-turn duration to compute it. */}
      <div className="flex overflow-hidden rounded-[9px] border border-border bg-bg">
        <Stat value={tools} label="Tool calls" />
        <Stat value={edits} label="Plan edits" last />
      </div>

      <div className="flex items-center gap-[10px]">
        <span className="inline-flex items-center gap-[7px] text-[12px] font-medium text-ink-2">
          <span
            className={`size-[7px] shrink-0 rounded-full ${
              live ? 'tp-pulse bg-primary' : agentPresent ? 'bg-[var(--tp-success)]' : 'bg-ink-3'
            }`}
            aria-hidden
          />
          {stateText}
        </span>
      </div>
    </div>
  );
}

function Stat({ value, label, last = false }: { value: number; label: string; last?: boolean }) {
  return (
    <div
      className={`flex flex-1 flex-col gap-[3px] p-[9px_11px] ${last ? '' : 'border-r border-border'}`}
    >
      <span className="font-display text-[16px] font-semibold leading-none text-ink">{value}</span>
      <span className="text-[9.5px] uppercase tracking-[0.05em] text-ink-3">{label}</span>
    </div>
  );
}

// An indeterminate bar shown only while a turn streams (kit `.act-prog`). The
// merge carries no progress fraction, so it sweeps rather than fabricating %.
function ProgressBar() {
  return (
    <div className="h-[3px] shrink-0 overflow-hidden bg-inset">
      <div className="tp-indeterminate h-full w-1/3 bg-primary" />
    </div>
  );
}
