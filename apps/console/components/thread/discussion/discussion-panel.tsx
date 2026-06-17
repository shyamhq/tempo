'use client';

import type { DiscussionMessage } from '@tempo/contracts';
import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_DISCUSSION_WIDTH, MIN_DISCUSSION_WIDTH, useThreadUi } from '@/store/thread-ui';
import { MessageComposer } from './message-composer';
import { MessageList } from './message-list';

export function DiscussionPanel({
  threadId,
  messages,
}: {
  threadId: string;
  messages: DiscussionMessage[];
}) {
  // Stamp "seen" whenever the panel renders open. Parent guarantees this
  // component only mounts while `discussionOpen` — so a mount equals an open
  // event.
  useEffect(() => {
    useThreadUi.getState().markDiscussionSeen(threadId);
  }, [threadId]);

  return (
    <aside aria-label="Discussion" className="relative flex flex-col h-full min-h-0 bg-canvas">
      <MessageList messages={messages} threadId={threadId} emptyState={<EmptyState />} />
      <MessageComposer threadId={threadId} autoFocus />
      <p className="px-5 pb-3 -mt-1 text-micro font-normal text-ink-tertiary">
        <kbd className="font-sans">⌘Enter</kbd> to send
        <span aria-hidden> · </span>
        <span className="sr-only">. </span>
        general discussion, not tied to a selection
      </p>
    </aside>
  );
}

export function ResizeHandle() {
  const width = useThreadUi((s) => s.discussionWidth);
  // Action ref is stable for the lifetime of the store — read once instead of
  // taking out a reactive subscription that can never fire.
  const setWidth = useThreadUi.getState().setDiscussionWidth;
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
    setWidth(start.startWidth + (e.clientX - start.startX));
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
      aria-valuemin={MIN_DISCUSSION_WIDTH}
      aria-valuemax={MAX_DISCUSSION_WIDTH}
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
          setWidth(width - (e.shiftKey ? 32 : 8));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setWidth(width + (e.shiftKey ? 32 : 8));
        } else if (e.key === 'Home') {
          e.preventDefault();
          setWidth(MIN_DISCUSSION_WIDTH);
        } else if (e.key === 'End') {
          e.preventDefault();
          setWidth(MAX_DISCUSSION_WIDTH);
        }
      }}
      data-dragging={dragging ? '' : undefined}
      className="absolute top-0 right-0 h-full w-1.5 -mr-[3px] cursor-col-resize group focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/15 z-10"
    >
      <div className="absolute inset-y-0 right-[2px] w-px bg-hairline group-hover:bg-accent group-focus-visible:bg-accent group-data-[dragging]:bg-accent group-data-[dragging]:w-0.5 transition-colors" />
      <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 h-10 w-1 rounded-full bg-accent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[dragging]:opacity-100 transition-opacity" />
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
