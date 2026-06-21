'use client';

// The kit-styled thread card that replaces BlockNote's stock floating Thread.
// Hosted by FloatingThreadController (comments-overlay.tsx), which positions it
// on the anchored text of the selected highlight — matching the kit's comment
// popover (Design System Planning Tool/ui_kits/workbench/index.html lines
// 211-233, 534-545): a canvas card with a 1px border + --tp-shadow-lg, an amber
// (--tp-hl-line) top bar, message rows, a reply box, and Resolve + Delete + Reply.
//
// Presentational: it reads the thread from the ThreadProps it is handed and acts
// through the T4.2 CommentThreadStore reached via the editor's CommentsExtension
// (createReply / resolve / unresolve / delete). It never calls fetch or a slice
// action directly — the store owns the optimistic write + API call.

import { CommentsExtension } from '@blocknote/core/comments';
import type { ThreadProps } from '@blocknote/react';
import { useBlockNoteEditor } from '@blocknote/react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CommentMessages } from './comment-messages';
import { CommentReplyBox } from './comment-reply-box';

export function CommentCard({
  thread,
  selected,
  orphaned,
  onFocus,
  onBlur,
  tabIndex,
}: ThreadProps) {
  const editor = useBlockNoteEditor();
  const threadStore = editor.getExtension(CommentsExtension)?.threadStore;

  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendReply = async (text: string) => {
    if (!threadStore || text.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await threadStore.addComment({
        threadId: thread.id,
        comment: { body: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] },
      });
    } catch {
      setError('Reply failed. Try again.');
    } finally {
      setSending(false);
    }
  };

  const toggleResolve = async () => {
    if (!threadStore || resolving) return;
    setResolving(true);
    setError(null);
    try {
      if (thread.resolved) await threadStore.unresolveThread({ threadId: thread.id });
      else await threadStore.resolveThread({ threadId: thread.id });
    } catch {
      setError('Could not update the comment. Try again.');
    } finally {
      setResolving(false);
    }
  };

  const remove = async () => {
    if (!threadStore || deleting) return;
    // window.confirm is the codebase's destructive-action pattern until the
    // Console grows a dialog primitive (see apps/console AGENTS.md note).
    if (!window.confirm('Delete this comment and all replies? This cannot be undone.')) return;
    setDeleting(true);
    setError(null);
    try {
      await threadStore.deleteThread({ threadId: thread.id });
    } catch {
      setError('Delete failed. The comment is unchanged.');
      setDeleting(false);
    }
  };

  // ring-hl-line / bg-hl-line are not Tailwind utilities that resolve from the
  // --color-hl-line token in every build, so reference the token directly.
  const ring = selected ? 'ring-1 ring-[var(--tp-hl-line)]' : '';
  const dim = orphaned ? 'opacity-90' : '';

  return (
    // a11y props forwarded by FloatingThreadController (onFocus/onBlur/tabIndex)
    // applied to the card container, with role + label for the thread group.
    // biome-ignore lint/a11y/useSemanticElements: native <fieldset> would require restyling; div+role=group is the WAI-ARIA grouping pattern for a comment thread.
    <div
      role="group"
      aria-label={`Comment thread${thread.resolved ? ' (resolved)' : ''}`}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onBlur={onBlur}
      className={`w-[300px] overflow-hidden rounded-xl border border-border bg-canvas shadow-lg ${ring} ${dim}`}
    >
      <div className="h-[3px] bg-hl-line" />
      <div className="max-h-[280px] overflow-y-auto px-[13px] pt-3 pb-1">
        <CommentMessages comments={thread.comments} />
      </div>
      <div className="flex flex-col gap-[9px] border-t border-border px-[11px] py-[9px]">
        {thread.resolved ? null : (
          <CommentReplyBox sending={sending} onSubmit={sendReply} placeholder="Reply…" />
        )}
        {error ? <p className="px-1 text-xs text-danger">{error}</p> : null}
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={resolving}
            onClick={toggleResolve}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-sans text-sm text-ink-2 transition-colors hover:bg-inset hover:text-success disabled:pointer-events-none disabled:opacity-50"
          >
            {resolving ? (
              <Loader2 className="size-[14px] animate-spin" aria-hidden />
            ) : (
              <Check className="size-[14px]" aria-hidden />
            )}
            {thread.resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={remove}
            aria-label="Delete comment"
            title="Delete"
            className="inline-flex items-center justify-center rounded-md p-1.5 text-ink-3 transition-colors hover:bg-inset hover:text-danger disabled:pointer-events-none disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="size-[14px] animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-[14px]" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
