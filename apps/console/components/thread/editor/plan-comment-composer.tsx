'use client';

// Replaces BlockNote's default FloatingComposer (the popover that appears
// when a Dev selects text and clicks Add Comment). Re-skinned to match the
// existing Tempo card aesthetic so the editor feels like the same product
// throughout.

import { CommentsExtension } from '@blocknote/core/comments';
import { useBlockNoteEditor, useExtension } from '@blocknote/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function PlanCommentComposer() {
  const editor = useBlockNoteEditor();
  const comments = useExtension(CommentsExtension);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const canSubmit = draft.trim().length > 0 && !sending;

  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    try {
      await comments.createThread({
        initialComment: {
          body: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: draft.trim(), styles: {} }],
            },
          ],
        },
      });
      comments.stopPendingComment();
      editor.focus();
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      comments.stopPendingComment();
      editor.focus();
    }
  };

  return (
    <div className="w-[360px] rounded-md border border-hairline bg-surface-1 p-3 shadow-card-elevated">
      <Textarea
        placeholder="Comment…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        autoFocus
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            comments.stopPendingComment();
            editor.focus();
          }}
          disabled={sending}
        >
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
          {sending ? 'Sending…' : 'Comment'}
        </Button>
      </div>
    </div>
  );
}
