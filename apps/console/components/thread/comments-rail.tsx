'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
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

  return (
    <div>
      <div className="sticky top-14 z-10 -mx-2 mb-3 flex items-center justify-between gap-2 bg-canvas/90 backdrop-blur px-2 py-2 border-b border-hairline">
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
