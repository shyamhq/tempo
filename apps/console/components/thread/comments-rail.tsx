'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
import { useEffect, useRef } from 'react';
import { CommentsCanvas } from './comments-canvas';

// page header (top-14 = 56) + grid py-6 top (24) + rail header (~52)
const HEADER_OFFSET = 130;

export function CommentsRail({
  threadId,
  comments,
  editor,
  showResolved,
  onShowResolvedChange,
  focusedCommentId,
  onFocusChange,
}: {
  threadId: string;
  comments: Comment[];
  editor: Editor | null;
  showResolved: boolean;
  onShowResolvedChange: (show: boolean) => void;
  focusedCommentId: string | null;
  onFocusChange: (id: string | null) => void;
}) {
  const visible = comments.filter((c) => showResolved || c.resolved_by === null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Sync rule: bring the anchor span into the page viewport (if it isn't), then
  // align the focused card's viewport top with the anchor's viewport top. Same
  // path for clicks originating in the editor or in the rail.
  useEffect(() => {
    if (!focusedCommentId || !editor) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const anchorEl = editor.view.dom.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(focusedCommentId)}"]`,
    );
    const cardEl = scroller.querySelector<HTMLElement>(
      `[data-comment-card="${CSS.escape(focusedCommentId)}"]`,
    );
    if (!anchorEl || !cardEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    // Only move the page when the anchor is completely off-screen. If any of
    // it is visible the user can already see what they're commenting on, so
    // leave the doc where it is and just slide the card.
    const offScreen = anchorRect.bottom < 0 || anchorRect.top > window.innerHeight;
    if (offScreen) {
      window.scrollBy({ top: anchorRect.top - HEADER_OFFSET, behavior: 'smooth' });
    }
    const target = offScreen ? HEADER_OFFSET : anchorRect.top;
    const delta = cardEl.getBoundingClientRect().top - target;
    if (Math.abs(delta) > 1) {
      scroller.scrollBy({ top: delta, behavior: 'smooth' });
    }
  }, [focusedCommentId, editor]);

  return (
    <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] flex flex-col">
      <div className="-mx-2 mb-3 flex items-center justify-between gap-2 bg-canvas/90 backdrop-blur px-2 py-2 border-b border-hairline">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-subtle">Comments</h2>
        <label className="flex items-center gap-2 text-xs text-ink-subtle cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => onShowResolvedChange(e.target.checked)}
            className="accent-accent"
          />
          Show resolved
        </label>
      </div>

      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto">
        <CommentsCanvas
          threadId={threadId}
          comments={visible}
          editor={editor}
          focusedCommentId={focusedCommentId}
          onFocusChange={onFocusChange}
        />
      </div>
    </div>
  );
}
