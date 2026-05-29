'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { CommentCard } from './comment-cards';
import { CommentsCanvas } from './comments-canvas';

export function CommentsRail({
  threadId,
  comments,
  archivedComments,
  editor,
  showResolved,
  onShowResolvedChange,
  focusedCommentId,
  onFocusChange,
}: {
  threadId: string;
  comments: Comment[];
  archivedComments: Comment[];
  editor: Editor | null;
  showResolved: boolean;
  onShowResolvedChange: (show: boolean) => void;
  focusedCommentId: string | null;
  onFocusChange: (id: string | null) => void;
}) {
  const [showArchive, setShowArchive] = useState(false);

  const visible = comments.filter((c) => showResolved || c.resolved_by === null);

  return (
    <div>
      <div className="sticky top-14 z-10 -mx-2 mb-3 flex items-center justify-between gap-2 bg-canvas/90 backdrop-blur px-2 py-2 border-b border-hairline">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-subtle">Comments</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-subtle cursor-pointer">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => onShowResolvedChange(e.target.checked)}
              className="accent-accent"
            />
            Show resolved
          </label>
          {archivedComments.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowArchive((v) => !v)}
              className="flex items-center gap-1 text-xs text-ink-subtle hover:text-ink"
            >
              {showArchive ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Archive ({archivedComments.length})
            </button>
          ) : null}
        </div>
      </div>

      {showArchive && archivedComments.length > 0 ? (
        <div className="mb-3 space-y-2 rounded-md border border-hairline bg-surface-1/50 p-2">
          {archivedComments.map((c) => (
            <CommentCard key={c.id} comment={c} archived />
          ))}
        </div>
      ) : null}

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
