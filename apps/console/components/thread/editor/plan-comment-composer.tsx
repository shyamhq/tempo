'use client';

// Replaces BlockNote's default FloatingComposer (the popover that appears
// when a Dev selects text and clicks Add Comment). Re-skinned to match the
// existing Tempo card aesthetic so the editor feels like the same product
// throughout.

import { CommentsExtension } from '@blocknote/core/comments';
import { useBlockNoteEditor, useExtension } from '@blocknote/react';
import { useRef, useState } from 'react';
import type { MentionableInputRef } from '@/components/thread/mention/mentionable-input';
import { MentionableInput } from '@/components/thread/mention/mentionable-input';
import { useMentionCandidates } from '@/components/thread/mention/use-mention-candidates';
import { Button } from '@/components/ui/button';

export function PlanCommentComposer() {
  const editor = useBlockNoteEditor();
  const comments = useExtension(CommentsExtension);
  const inputRef = useRef<MentionableInputRef>(null);
  const candidates = useMentionCandidates();

  const [hasText, setHasText] = useState(false);
  const [sending, setSending] = useState(false);

  const canSubmit = hasText && !sending;

  const submit = async () => {
    if (!canSubmit || !inputRef.current) return;
    const doc = inputRef.current.serialise();
    if (doc.text.length === 0) return;
    setSending(true);
    try {
      await comments.createThread({
        initialComment: {
          body: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: doc.text, styles: {} }],
            },
          ],
          // Bridge reads mentions off metadata and forwards to createReply.
          metadata: doc.mentions.length > 0 ? { mentions: doc.mentions } : undefined,
        },
      });
      comments.stopPendingComment();
      editor.focus();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-[360px] rounded-md border border-hairline bg-surface-1 p-3 shadow-card-elevated">
      <div className="rounded-lg border border-hairline bg-surface-2 px-3.5 py-2.5">
        <MentionableInput
          ref={inputRef}
          placeholder="Comment…"
          candidates={candidates}
          autoFocus
          minHeight={48}
          maxHeight={160}
          onSubmit={() => void submit()}
          onChange={(doc) => setHasText(doc.text.length > 0)}
        />
      </div>
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
