'use client';

// The thread-view composition root (T5.1). Opens the thread session (hydrate the
// slices + the one event gateway), then lays out the kit's `.work` area (Design
// System Planning Tool/ui_kits/workbench/index.html lines 91, 412-507): the
// top-bar on top, then the `.split` (plan editor | resizer | discussion dock).
// The Phase-5b status strip slots in below the split — not built here (T5.2).
//
// This is the one layer that composes across features (top-bar, plan, discussion)
// — none of them import each other. The plan-markdown getter is held here as a
// ref: PlanEditor registers `editor.blocksToMarkdownLossy(...)` through
// registerGetMarkdown, and the top-bar's Copy plan / Execute read it — so the
// handoff works without a cross-feature import.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef } from 'react';
import { useThreadSession } from '@/hooks/useThreadSession';
import { useDiscussionWidth, useDockOpen, useThreadStore } from '@/store';
import { MAX_DISCUSSION_WIDTH, MIN_DISCUSSION_WIDTH } from '@/store/ui';
import { DiscussionDock } from '../../discussion/components/discussion-dock';
import { ThreadTopBar } from './thread-topbar';

// BlockNote must mount client-only — it reaches for the DOM at module load.
const PlanEditor = dynamic(
  () => import('@/features/plan/components/plan-editor').then((m) => m.PlanEditor),
  { ssr: false },
);

export function ThreadView({ threadId }: { threadId: string }) {
  useThreadSession(threadId);

  const dockOpen = useDockOpen();
  const discussionWidth = useDiscussionWidth();

  // PlanEditor registers its markdown export here; the top-bar reads it for the
  // Copy plan / Execute handoff. Null until the editor has mounted.
  const getMarkdownRef = useRef<(() => Promise<string>) | null>(null);
  const registerGetMarkdown = useCallback((fn: (() => Promise<string>) | null) => {
    getMarkdownRef.current = fn;
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ThreadTopBar threadId={threadId} getMarkdown={() => getMarkdownRef.current?.() ?? null} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <PlanEditor threadId={threadId} registerGetMarkdown={registerGetMarkdown} />
        </div>

        {dockOpen ? (
          <>
            <DockResizer width={discussionWidth} />
            <div className="h-full min-h-0 shrink-0" style={{ width: discussionWidth }}>
              <DiscussionDock threadId={threadId} />
            </div>
          </>
        ) : null}
      </div>

      {/* T5.2 status strip slots in here. */}
    </div>
  );
}

// The 1px split handle (kit `.resizer`, lines 156-157): a hairline bar with a
// wider invisible drag hitbox. Keyboard-accessible per the WAI-ARIA window-
// splitter pattern (arrows adjust, Home/End jump to the clamp bounds).
function DockResizer({ width }: { width: number }) {
  const setWidth = useThreadStore((s) => s.setDiscussionWidth);
  const startRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  // If the dock unmounts mid-drag (the Discussion toggle removes it), the
  // pointerup that would restore the body cursor/selection never fires — restore
  // them on unmount so a drag-then-unmount can't leave the page stuck in
  // col-resize with text selection disabled.
  useEffect(
    () => () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    // Dragging left (smaller clientX) widens the dock — it sits on the right edge.
    setWidth(start.startWidth - (e.clientX - start.startX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    startRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: div+role=separator is the WAI-ARIA window-splitter pattern; <hr> carries no value semantics for aria-valuenow.
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize Discussion panel"
      aria-orientation="vertical"
      aria-valuemin={MIN_DISCUSSION_WIDTH}
      aria-valuemax={MAX_DISCUSSION_WIDTH}
      aria-valuenow={width}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setWidth(width + (e.shiftKey ? 32 : 8));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setWidth(width - (e.shiftKey ? 32 : 8));
        } else if (e.key === 'Home') {
          e.preventDefault();
          setWidth(MAX_DISCUSSION_WIDTH);
        } else if (e.key === 'End') {
          e.preventDefault();
          setWidth(MIN_DISCUSSION_WIDTH);
        }
      }}
      className="relative w-px shrink-0 cursor-col-resize bg-border-strong outline-none after:absolute after:inset-y-0 after:-inset-x-[3px] after:content-[''] focus-visible:bg-primary"
    />
  );
}
