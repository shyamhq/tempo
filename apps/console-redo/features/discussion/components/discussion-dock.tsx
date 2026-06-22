'use client';

// The Discussion dock. Mirrors the kit's `.discussion` (Design System Planning
// Tool/ui_kits/workbench/index.html lines 159-203, 470-491): a vertical flex
// column with the `.disc-h` header (chat icon + "Discussion" + agent live/idle
// status), the scrollable `.disc-log`, and the composer pinned at the bottom.
//
// Presentational: it reads the discussion + agent presence via store selectors
// and renders rows. It stamps "seen" on mount (a mount equals an open event —
// the dock only renders while dockOpen). Auto-stick (snap on mount, re-stick on
// new messages / content resize, release when the Dev scrolls up) is owned by
// use-stick-to-bottom, mirroring apps/console's MessageList.

import { MessageSquare } from 'lucide-react';
import { useEffect } from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { useAgentPresent, useDiscussion, useThreadStore } from '@/store';
import { DiscussionComposer } from './discussion-composer';
import { DiscussionMessageRow } from './discussion-message';
import { ProvisioningCard } from './provisioning-card';
import { LiveQuestionCard, MinimizedQuestionCard } from './question-card';

export function DiscussionDock({ threadId }: { threadId: string }) {
  const messages = useDiscussion();
  const agentPresent = useAgentPresent();

  // Snap to bottom on mount, smooth-stick as messages arrive, release the lock
  // when the Dev scrolls up — all handled by use-stick-to-bottom.
  const { scrollRef, contentRef } = useStickToBottom({ initial: 'instant', resize: 'smooth' });

  useEffect(() => {
    useThreadStore.getState().markDiscussionSeen(threadId);
  }, [threadId]);

  return (
    <aside
      aria-label="Discussion"
      className="flex h-full min-h-0 flex-col border-l border-border bg-panel"
    >
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-border pl-[14px] pr-3">
        <span className="flex text-ink-2">
          <MessageSquare className="size-[15px]" aria-hidden />
        </span>
        <span className="font-display text-[13px] font-semibold text-ink">Discussion</span>
        <span
          className={`ml-auto flex items-center gap-1.5 text-[11.5px] ${agentPresent ? 'text-primary' : 'text-ink-2'}`}
        >
          <span
            className={`size-[7px] shrink-0 rounded-full ${agentPresent ? 'animate-pulse bg-primary' : 'bg-ink-3'}`}
          />
          {agentPresent ? 'Agent live' : 'Agent idle'}
        </span>
      </div>

      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pt-[2px] pb-2">
          <div ref={contentRef} className="flex flex-col">
            {/* Hosted-VM provisioning checklist — renders nothing for Local or once
                there's no VM state to report. Sits above the first message. */}
            <ProvisioningCard />
            {messages.map((m, i) => {
              // A question-message that is the LAST message overall is the live
              // (interactive) stepper; once the Dev's answer message appends via
              // SSE it is no longer last and collapses to a summary. Every
              // non-question message is the normal row. Mirrors apps/console's
              // MessageList (`isLive = isQuestion && i === lastIdx`).
              if (m.questions === null || m.questions.length === 0)
                return <DiscussionMessageRow key={m.id} message={m} />;
              if (i === messages.length - 1)
                return (
                  <LiveQuestionCard
                    key={m.id}
                    message={m}
                    questions={m.questions}
                    threadId={threadId}
                  />
                );
              return <MinimizedQuestionCard key={m.id} message={m} questions={m.questions} />;
            })}
          </div>
        </div>
      )}

      <DiscussionComposer threadId={threadId} />
    </aside>
  );
}

// First-run prompt — adapts apps/console's DiscussionPanel EmptyState copy to the
// kit's muted-ink scale.
function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <p className="max-w-[260px] text-center text-[12.5px] leading-[1.55] text-ink-3">
        Ask the Agent about the approach, or describe a change to the plan.
      </p>
    </div>
  );
}
