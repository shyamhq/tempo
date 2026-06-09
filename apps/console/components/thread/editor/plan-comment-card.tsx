'use client';

// Replaces BlockNote's default FloatingThread card (the popover for a focused
// comment thread). Re-skinned to match Tempo's card aesthetic. "Comment
// thread" here refers to BlockNote's annotation entity — Tempo's Comment +
// Replies. Distinct from Tempo's planning `Thread`.

import type { CommentData } from '@blocknote/core/comments';
import { CommentsExtension } from '@blocknote/core/comments';
import type { ThreadProps } from '@blocknote/react';
import { useBlockNoteEditor, useUsers } from '@blocknote/react';
import { Check, CornerDownLeft, Loader2, Maximize2, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { MarkdownText } from '@/components/thread/markdown-text';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/tooltip';
import { useCommentUi } from '@/store/comment-ui';

export type PlanCommentCardVariant = 'card' | 'panel';

export function PlanCommentCard({
  thread,
  selected,
  orphaned,
  onFocus,
  onBlur,
  tabIndex,
  variant = 'card',
}: ThreadProps & { variant?: PlanCommentCardVariant }) {
  const editor = useBlockNoteEditor();
  const ext = editor.getExtension(CommentsExtension);
  const threadStore = ext?.threadStore;

  const authorIds = [...new Set(thread.comments.map((c) => c.userId))];
  const users = useUsers(authorIds);

  const [replyDraft, setReplyDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: replyDraft is the resize trigger
  useLayoutEffect(() => {
    const el = replyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [replyDraft]);

  const canReply = replyDraft.trim().length > 0 && !sending && threadStore !== undefined;

  const sendReply = async () => {
    if (!canReply || !threadStore) return;
    setSending(true);
    try {
      await threadStore.addComment({
        threadId: thread.id,
        comment: {
          body: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: replyDraft.trim(), styles: {} }],
            },
          ],
        },
      });
      setReplyDraft('');
    } finally {
      setSending(false);
    }
  };

  const toggleResolve = async () => {
    if (resolving || !threadStore) return;
    setResolving(true);
    try {
      if (thread.resolved) await threadStore.unresolveThread({ threadId: thread.id });
      else await threadStore.resolveThread({ threadId: thread.id });
    } finally {
      setResolving(false);
    }
  };

  const doDelete = async () => {
    if (deleting || !threadStore) return;
    // window.confirm + window.alert are the existing destructive-action
    // pattern in this codebase (see DeleteThreadButton). Both replaced when
    // the Console grows a toast primitive — filed in AGENTS.md.
    const ok = window.confirm('Delete this comment and all replies? This cannot be undone.');
    if (!ok) return;
    setDeleting(true);
    try {
      await threadStore.deleteThread({ threadId: thread.id });
    } catch {
      // The bridge surfaces nothing; loud failure beats silent on delete.
      window.alert('Delete failed. The comment is unchanged.');
    } finally {
      setDeleting(false);
    }
  };

  const onReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void sendReply();
    }
  };

  const baseBorder = selected ? 'border-2 border-accent' : 'border-hairline';
  const border = `${baseBorder}${orphaned ? ' border-dashed' : ''}`;
  const shadow = selected ? ' shadow-card-elevated' : '';

  const setEnlarged = useCommentUi((s) => s.setEnlarged);
  const canEnlarge = variant === 'card';

  const outerClass =
    variant === 'panel'
      ? 'flex flex-col w-full h-full bg-surface-1'
      : `w-[360px] border bg-surface-1 ${border}${shadow} rounded-xl overflow-hidden`;
  const listClass =
    variant === 'panel'
      ? `flex flex-col flex-1 min-h-0 overflow-y-auto pt-1.5 transition-opacity ${
          thread.resolved ? 'opacity-50' : ''
        }`
      : `flex flex-col max-h-[33vh] overflow-y-auto pt-1.5 transition-opacity ${
          thread.resolved ? 'opacity-50' : ''
        }`;

  return (
    <div
      role="group"
      aria-label="Comment"
      onFocus={onFocus}
      onBlur={onBlur}
      tabIndex={tabIndex}
      className={outerClass}
    >
      {canEnlarge ? (
        <div className="flex items-center justify-end px-2 pt-1.5">
          <Tooltip content="Open in rail">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEnlarged(thread.id);
              }}
              aria-label="Enlarge comment into rail"
              className="inline-flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md p-1.5"
            >
              <Maximize2 className="size-icon-xs" aria-hidden />
            </button>
          </Tooltip>
        </div>
      ) : null}
      <div className={listClass}>
        {thread.comments.map((c) => (
          <PlanCommentRow
            key={c.id}
            comment={c}
            username={users.get(c.userId)?.username ?? c.userId}
          />
        ))}
      </div>

      {thread.resolved ? (
        <div className="flex items-center justify-between gap-2.5 px-4 pt-3 pb-4">
          <span className="inline-flex items-center gap-2 text-body-sm font-medium text-accent-deep">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent/10 text-accent-deep">
              <Check className="size-icon-xs" strokeWidth={3} aria-hidden />
            </span>
            Resolved
          </span>
          <button
            type="button"
            disabled={resolving}
            onClick={(e) => {
              e.stopPropagation();
              void toggleResolve();
            }}
            className="text-body-sm font-medium text-ink-subtle hover:text-ink disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md px-1 py-0.5"
          >
            Reopen
          </button>
        </div>
      ) : (
        <>
          <div className="px-4 pt-1.5">
            <Textarea
              ref={replyRef}
              placeholder="Reply…"
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              onKeyDown={onReplyKeyDown}
              rows={1}
              className="text-body-sm min-h-0 resize-none overflow-hidden bg-surface-2 border-hairline rounded-lg px-3.5 py-2.5"
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-4">
            <div className="flex items-center gap-1">
              <Tooltip content={thread.resolved ? 'Reopen' : 'Resolve'}>
                <button
                  type="button"
                  disabled={resolving}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleResolve();
                  }}
                  className="inline-flex items-center gap-1.5 text-body-sm font-medium text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md px-2 py-1.5"
                >
                  {resolving ? (
                    <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-icon-sm" aria-hidden />
                  )}
                  Resolve
                </button>
              </Tooltip>
              <Tooltip content="Delete">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    void doDelete();
                  }}
                  className="inline-flex items-center justify-center text-ink-subtle hover:text-danger hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft rounded-md p-1.5"
                  aria-label="Delete comment"
                >
                  {deleting ? (
                    <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-icon-sm" aria-hidden />
                  )}
                </button>
              </Tooltip>
            </div>
            <Button
              variant="accent"
              size="md"
              disabled={!canReply}
              onClick={(e) => {
                e.stopPropagation();
                void sendReply();
              }}
            >
              <CornerDownLeft className="size-icon-sm" aria-hidden />
              Reply
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PlanCommentRow({ comment, username }: { comment: CommentData; username: string }) {
  const text = comment.body ? extractText(comment.body as BlockLike[]) : '';
  return (
    <div className="px-4 py-2.5 border-t border-hairline-soft first:border-t-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span aria-hidden className="size-[7px] rounded-full bg-ink-subtle" />
        <span className="text-micro-uppercase uppercase font-semibold text-ink-subtle">
          {username}
        </span>
        <span className="text-caption text-ink-tertiary tabular-nums">
          {`· ${formatTime(comment.createdAt)}`}
        </span>
      </div>
      {text.length > 0 ? (
        <MarkdownText text={text} className="[&_p]:text-body-sm" />
      ) : (
        <span className="text-body-sm text-ink-tertiary italic">(deleted)</span>
      )}
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

type InlineLike = { text?: string };
type BlockLike = { content?: InlineLike[]; children?: BlockLike[] };

function extractText(blocks: BlockLike[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (Array.isArray(block.content)) {
      for (const inline of block.content) {
        if (typeof inline.text === 'string') out.push(inline.text);
      }
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      const nested = extractText(block.children);
      if (nested) out.push(nested);
    }
    out.push('\n');
  }
  return out.join('').trim();
}
