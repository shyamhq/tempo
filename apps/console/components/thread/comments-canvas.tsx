'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAnchorPositions } from '@/hooks/use-anchor-positions';
import { useComposerStore } from '@/lib/stores/composer-store';
import { CommentCard, NewCommentCard } from './comment-cards';

const CARD_GAP = 12;
const PENDING_KEY = '__pending';

// Absolute-positioning canvas: places each comment card at its anchor's y in
// container-local pixels, then walks top-to-bottom pushing later cards down
// to avoid overlap. Focused card pins to its true anchor; neighbours flow.
// First paint of a newly-mounted card is invisible until heights are measured
// — see A7 in the plan.
export function CommentsCanvas({
  comments,
  editor,
  threadId,
  focusedCommentId,
  onFocusChange,
}: {
  comments: Comment[];
  editor: Editor | null;
  threadId: string;
  focusedCommentId: string | null;
  onFocusChange: (id: string | null) => void;
}) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const composerOpen = useComposerStore((s) => s.open);

  const { positions, pendingY, editorHeight } = useAnchorPositions(editor, containerEl);

  const [heights, setHeights] = useState<Map<string, number>>(new Map());

  const reportHeight = useCallback((id: string, h: number) => {
    setHeights((prev) => {
      const cur = prev.get(id);
      if (cur !== undefined && Math.abs(cur - h) < 0.5) return prev;
      const next = new Map(prev);
      next.set(id, h);
      return next;
    });
  }, []);

  const layout = useMemo(
    () =>
      computeLayout({
        comments,
        positions,
        pendingY,
        composerOpen,
        heights,
        focusedId: focusedCommentId,
      }),
    [comments, positions, pendingY, composerOpen, focusedCommentId, heights],
  );

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!focusedCommentId) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-comment-card]')) return;
      if (target.closest('[data-comment-id]')) return;
      onFocusChange(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedCommentId) onFocusChange(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [focusedCommentId, onFocusChange]);

  const hasAnything = comments.length > 0 || composerOpen;

  return (
    <div
      ref={setContainerEl}
      className="relative"
      style={{ minHeight: editorHeight ? `${editorHeight}px` : undefined }}
    >
      {!hasAnything ? (
        <p className="text-xs text-ink-tertiary py-4 text-center border border-dashed border-hairline rounded-md">
          Select any Plan text to start a Comment.
        </p>
      ) : null}

      {composerOpen && pendingY !== null ? (
        <PositionedCard
          id={PENDING_KEY}
          y={layout.placements.get(PENDING_KEY) ?? pendingY}
          measured={heights.has(PENDING_KEY)}
          onMeasure={reportHeight}
        >
          <NewCommentCard threadId={threadId} />
        </PositionedCard>
      ) : null}

      {comments.map((c) => {
        const place = layout.placements.get(c.id);
        if (place === undefined) return null;
        return (
          <PositionedCard
            key={c.id}
            id={c.id}
            y={place}
            measured={heights.has(c.id)}
            onMeasure={reportHeight}
          >
            <CommentCard
              comment={c}
              focused={focusedCommentId === c.id}
              onFocus={() => onFocusChange(c.id)}
            />
          </PositionedCard>
        );
      })}
    </div>
  );
}

function PositionedCard({
  id,
  y,
  measured,
  onMeasure,
  children,
}: {
  id: string;
  y: number;
  measured: boolean;
  onMeasure: (id: string, height: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onMeasure(id, el.getBoundingClientRect().height);
    });
    ro.observe(el);
    onMeasure(id, el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [id, onMeasure]);

  return (
    <div
      ref={ref}
      data-comment-card={id}
      style={{
        position: 'absolute',
        top: `${y}px`,
        left: 0,
        right: 0,
        opacity: measured ? 1 : 0,
        transition: 'top 150ms ease-out, opacity 100ms ease-out',
      }}
    >
      {children}
    </div>
  );
}

type LayoutResult = {
  placements: Map<string, number>;
};

function computeLayout({
  comments,
  positions,
  pendingY,
  composerOpen,
  heights,
  focusedId,
}: {
  comments: Comment[];
  positions: Map<string, number>;
  pendingY: number | null;
  composerOpen: boolean;
  heights: Map<string, number>;
  focusedId: string | null;
}): LayoutResult {
  const entries: { id: string; anchorY: number; height: number }[] = [];

  for (const c of comments) {
    const y = positions.get(c.id);
    if (y === undefined) continue;
    entries.push({ id: c.id, anchorY: y, height: heights.get(c.id) ?? 0 });
  }
  if (composerOpen && pendingY !== null) {
    entries.push({ id: PENDING_KEY, anchorY: pendingY, height: heights.get(PENDING_KEY) ?? 0 });
  }

  entries.sort((a, b) => a.anchorY - b.anchorY);

  const placements = new Map<string, number>();
  const focusedIdx = focusedId ? entries.findIndex((e) => e.id === focusedId) : -1;

  if (focusedIdx === -1) {
    let cursor = -Infinity;
    for (const e of entries) {
      const placed = Math.max(e.anchorY, cursor + CARD_GAP);
      placements.set(e.id, placed);
      cursor = placed + e.height;
    }
    return { placements };
  }

  // biome-ignore lint/style/noNonNullAssertion: focusedIdx is in-bounds by construction
  const focused = entries[focusedIdx]!;
  placements.set(focused.id, focused.anchorY);

  let upBottom = focused.anchorY;
  for (let i = focusedIdx - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: i is in-bounds by loop condition
    const e = entries[i]!;
    const desired = Math.min(e.anchorY, upBottom - CARD_GAP - e.height);
    placements.set(e.id, desired);
    upBottom = desired;
  }

  let downTop = focused.anchorY + focused.height;
  for (let i = focusedIdx + 1; i < entries.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i is in-bounds by loop condition
    const e = entries[i]!;
    const desired = Math.max(e.anchorY, downTop + CARD_GAP);
    placements.set(e.id, desired);
    downTop = desired + e.height;
  }

  return { placements };
}
