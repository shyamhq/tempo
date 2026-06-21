'use client';

// The kit-styled floating composer for a NEW comment, shown on a text
// selection. Replaces BlockNote's stock FloatingComposer; hosted by
// FloatingComposerController (comments-overlay.tsx), which positions it on the
// pending selection. Mirrors the kit's new-comment popover (Design System
// Planning Tool/ui_kits/workbench/index.html lines 535-545, 641): the same card
// chrome as the thread card, a "New comment on selected text" label, and the
// shared reply field.
//
// Creating a thread goes through the CommentsExtension's createThread, which
// delegates to the T4.2 CommentThreadStore (anchor capture + POST + optimistic
// slice write). On success we select the new thread so its card opens in place
// of the composer — the Dev keeps reading/replying instead of the card vanishing.
// We don't call stopPendingComment (selecting a thread already clears
// pendingComment in BlockNote's store), and we never refocus the editor (its
// focus() scrolls the contenteditable to the top).

import { CommentsExtension } from '@blocknote/core/comments';
import { useBlockNoteEditor } from '@blocknote/react';
import { useState } from 'react';
import { useThreadStore } from '@/store';
import { CommentReplyBox } from './comment-reply-box';

export function CommentComposer() {
  const editor = useBlockNoteEditor();
  const ext = editor.getExtension(CommentsExtension);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (text: string) => {
    if (!ext || sending) return;
    setSending(true);
    setError(null);
    // The new Comment id isn't returned by BlockNote's createThread, but the
    // store's createThread adds it to the slice synchronously before the await
    // resolves; the new id is the one absent from this pre-create snapshot.
    const before = new Set(useThreadStore.getState().comments.map((c) => c.id));
    try {
      await ext.createThread({
        initialComment: {
          body: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }],
        },
      });
      const created = useThreadStore.getState().comments.find((c) => !before.has(c.id));
      if (created) ext.selectThread(created.id, false);
      else ext.stopPendingComment();
    } catch {
      setError('Could not create the comment. Try again.');
      setSending(false);
    }
  };

  return (
    <div className="w-[300px] overflow-hidden rounded-xl border border-border bg-canvas shadow-lg">
      <div className="h-[3px] bg-hl-line" />
      <div className="flex flex-col gap-[9px] px-[13px] py-3">
        <p className="font-sans text-sm text-ink-3">New comment on selected text</p>
        <CommentReplyBox
          autoFocus
          sending={sending}
          onSubmit={create}
          placeholder="Add a comment…"
          submitLabel="Comment"
        />
        {error ? <p className="px-1 text-xs text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
