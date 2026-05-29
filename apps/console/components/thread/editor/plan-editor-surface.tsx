'use client';

import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { MessageSquarePlus } from 'lucide-react';

export function PlanEditorSurface({
  editor,
  startComment,
  composerOpen,
}: {
  editor: Editor | null;
  startComment: () => void;
  composerOpen: boolean;
}) {
  return (
    <div className="plan-editor-dense">
      {editor ? (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: ed, from, to }) => {
            if (!ed.isEditable) return false;
            if (from === to) return false;
            if (composerOpen) return false;
            const text = ed.state.doc.textBetween(from, to, '\n');
            return text.trim().length > 0;
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={startComment}
            className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface-1 px-2 py-1 text-xs text-ink-subtle shadow-md hover:text-ink hover:border-hairline-strong"
            aria-label="Comment on selection"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Comment
          </button>
        </BubbleMenu>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
