'use client';

import type { DiscussionMessage } from '@tempo/contracts';
import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MessageComposer } from './message-composer';
import { MessageList } from './message-list';

export function DiscussionPanel({
  threadId,
  messages,
  approved,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onOpened,
}: {
  threadId: string;
  messages: DiscussionMessage[];
  approved: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (w: number) => void;
  onOpened: () => void;
}) {
  // Stamp "seen" whenever the panel renders open. Parent guarantees this
  // component only mounts while `open` — so a mount equals an open event.
  useEffect(() => {
    onOpened();
  }, [onOpened]);

  // Composer disabled only when the Thread is frozen (approved). When a live
  // question card sits at the bottom of the timeline the Dev can still post
  // free-form pushback — sending any message supersedes the card.
  const composerDisabled = approved;
  const composerReason = approved
    ? 'Thread is approved — reopen to continue the Discussion.'
    : null;

  return (
    <aside
      aria-label="Discussion"
      className="relative flex flex-col h-full min-h-0 bg-canvas overflow-hidden"
    >
      <MessageList messages={messages} threadId={threadId} emptyState={<EmptyState />} />
      <MessageComposer
        threadId={threadId}
        disabled={composerDisabled}
        disabledReason={composerReason}
        autoFocus={!composerDisabled}
      />
      <p className="px-5 pb-3 -mt-1 text-micro font-normal text-ink-tertiary">
        <kbd className="font-sans">⌘Enter</kbd> to send
        <span aria-hidden> · </span>
        <span className="sr-only">. </span>
        general discussion, not tied to a selection
      </p>
      <ResizeHandle
        width={width}
        minWidth={minWidth}
        maxWidth={maxWidth}
        onWidthChange={onWidthChange}
      />
    </aside>
  );
}

function ResizeHandle({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
}: {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (w: number) => void;
}) {
  const startRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Body cursor/select tied to dragging state, not to handler call order — if
  // the panel unmounts (Escape, ⌘/) mid-drag, the cleanup restores them.
  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: width };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    const delta = e.clientX - start.startX;
    const next = Math.max(minWidth, Math.min(maxWidth, start.startWidth + delta));
    onWidthChange(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    startRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> has no value semantics; div+role=separator is the WAI-ARIA window-splitter pattern.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Discussion panel"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onWidthChange(Math.max(minWidth, width - (e.shiftKey ? 32 : 8)));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onWidthChange(Math.min(maxWidth, width + (e.shiftKey ? 32 : 8)));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onWidthChange(minWidth);
        } else if (e.key === 'End') {
          e.preventDefault();
          onWidthChange(maxWidth);
        }
      }}
      className="absolute top-0 right-0 h-full w-1.5 -mr-[3px] cursor-col-resize group focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/15 z-10"
    >
      <div className="absolute inset-y-0 right-[2px] w-px bg-hairline group-hover:bg-accent group-focus-visible:bg-accent transition-colors" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-[260px] text-center">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-accent mb-3">
        <Sparkles className="h-4 w-4" />
      </div>
      <p className="text-caption text-ink leading-[1.55] mb-1.5 font-medium">
        Ask the Agent about the approach
      </p>
      <p className="text-micro font-normal text-ink-subtle leading-[1.55]">
        Anything that isn't tied to a specific line of the Plan — e.g. "Why did you reject the
        polling approach?"
      </p>
    </div>
  );
}
