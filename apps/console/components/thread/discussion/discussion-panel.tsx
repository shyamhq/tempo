'use client';

import type { DiscussionMessage, PendingRound, SessionStatus } from '@tempo/contracts';
import { Sparkles, X } from 'lucide-react';
import { useEffect } from 'react';
import { MessageComposer } from './message-composer';
import { MessageList } from './message-list';
import { RoundCard } from './round-card';

export function DiscussionPanel({
  threadId,
  messages,
  pendingRound,
  approved,
  sessionStatus,
  onClose,
  onOpened,
}: {
  threadId: string;
  messages: DiscussionMessage[];
  pendingRound: PendingRound | null;
  approved: boolean;
  sessionStatus: SessionStatus;
  onClose: () => void;
  onOpened: () => void;
}) {
  // Stamp "seen" whenever the panel renders open. Parent guarantees this
  // component only mounts while `open` — so a mount equals an open event.
  useEffect(() => {
    onOpened();
  }, [onOpened]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pendingRound) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pendingRound]);

  const composerDisabled = approved || pendingRound !== null;
  let composerReason: string | null = null;
  if (approved) {
    composerReason = 'Thread is approved — reopen to continue the Discussion.';
  } else if (pendingRound) {
    composerReason = 'Answer the Round above to continue.';
  }

  return (
    <aside
      aria-label="Discussion"
      className="flex flex-col h-full min-h-0 bg-canvas border-r border-hairline overflow-hidden"
    >
      <PanelHeader sessionStatus={sessionStatus} canClose={!pendingRound} onClose={onClose} />
      <MessageList
        messages={messages}
        endSlot={pendingRound ? <RoundCard round={pendingRound} /> : null}
        emptyState={<EmptyState />}
      />
      <MessageComposer
        threadId={threadId}
        disabled={composerDisabled}
        disabledReason={composerReason}
        autoFocus={!composerDisabled}
      />
    </aside>
  );
}

function PanelHeader({
  sessionStatus,
  canClose,
  onClose,
}: {
  sessionStatus: SessionStatus;
  canClose: boolean;
  onClose: () => void;
}) {
  const connected = sessionStatus === 'connected';
  return (
    <div className="flex items-center justify-between gap-3 px-5 h-12 bg-canvas/85 backdrop-blur sticky top-0 z-10">
      <div className="flex items-center gap-2.5 min-w-0">
        <h2 className="font-display text-[15px] font-semibold text-ink truncate">Discussion</h2>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] text-ink-tertiary shrink-0"
          title={
            connected ? 'Agent connected' : 'Agent disconnected — messages deliver on reconnect'
          }
        >
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-success' : 'bg-ink-tertiary'
            }`}
          />
          {connected ? 'connected' : 'offline'}
        </span>
      </div>
      {canClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Discussion"
          className="inline-flex items-center justify-center h-7 w-7 -mr-1 rounded-md text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-[260px] text-center">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-accent mb-3">
        <Sparkles className="h-4 w-4" />
      </div>
      <p className="text-[13px] text-ink leading-[1.55] mb-1.5 font-medium">
        Ask the Agent about the approach
      </p>
      <p className="text-[12px] text-ink-subtle leading-[1.55]">
        Anything that isn't tied to a specific line of the Plan — e.g. "Why did you reject the
        polling approach?"
      </p>
    </div>
  );
}
