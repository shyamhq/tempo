'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
import { useEffect } from 'react';
import { CommentsCanvas } from './comments-canvas';

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

  // On focus change, bring the anchor into the viewport. `block: 'nearest'`
  // is a no-op when the anchor is already visible and the minimum scroll
  // otherwise — so clicking a visible highlight doesn't jump the page, and
  // clicking a card whose text is off-screen scrolls just enough to show it.
  // The card itself is anchored to that y by the canvas, so it follows.
  useEffect(() => {
    if (!focusedCommentId || !editor?.view) return;
    const anchorEl = editor.view.dom.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(focusedCommentId)}"]`,
    );
    if (!anchorEl) return;
    anchorEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedCommentId, editor]);

  return (
    <div>
      <div className="-mx-2 mb-3 flex items-center justify-between gap-2 px-2 py-2 border-b border-hairline">
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

      <CommentsCanvas
        threadId={threadId}
        comments={visible}
        editor={editor}
        focusedCommentId={focusedCommentId}
        onFocusChange={onFocusChange}
      />
    </div>
  );
}
