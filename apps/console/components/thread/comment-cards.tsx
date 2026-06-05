'use client';

import type { Comment, Reply } from '@tempo/contracts';
import { Check, CornerDownLeft, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/tooltip';
import { useUnreadAgentReplies } from '@/hooks/use-unread-agent-replies';
import { api } from '@/lib/api-client';
import { useComposerStore } from '@/lib/stores/composer-store';
import { MarkdownText } from './markdown-text';

export function NewCommentCard({ threadId }: { threadId: string }) {
  const { plan_quote, plan_context, draft, setDraft, cancel } = useComposerStore();
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = async () => {
    const first_reply_text = draft.trim();
    if (!first_reply_text) return;
    setSending(true);
    try {
      // One atomic call: server inserts comment + first Dev reply in a
      // transaction and emits one `comment_added` event with the reply
      // baked into `replies`. SSE then delivers a complete CommentCard —
      // no empty-comment intermediate state.
      const c = await api.createComment(threadId, {
        plan_quote,
        plan_context,
        first_reply_text,
      });
      // Single zustand set: close composer AND hand off the new id for the
      // editor's CommentMark effect. Two separate calls would produce two
      // renders and risk the comment anchoring a frame after it appears.
      useComposerStore.setState({
        open: false,
        plan_quote: '',
        plan_context: '',
        draft: '',
        lastCreatedCommentId: c.id,
      });
    } catch {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <div className="rounded-md border border-highlight/60 bg-surface-2 p-3 shadow-md">
      <Textarea
        ref={textareaRef}
        placeholder="Comment…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={cancel} disabled={sending}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={sending || !draft.trim()} onClick={submit}>
          {sending ? 'Sending…' : 'Comment'}
        </Button>
      </div>
    </div>
  );
}

export function CommentCard({
  comment,
  focused = false,
  orphan = false,
  onFocus,
}: {
  comment: Comment;
  focused?: boolean;
  orphan?: boolean;
  onFocus?: () => void;
}) {
  const [replyDraft, setReplyDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const { unreadCount, markSeen } = useUnreadAgentReplies(comment.thread_id, comment);

  // Pulse only on the unread-count 0→positive transition while the card is
  // not focused — the "look here, something arrived" cue. The ref is seeded
  // from the first render so initial mount with unread state doesn't pulse.
  const prevUnreadCountRef = useRef<number>(unreadCount);
  const [pulsing, setPulsing] = useState(false);

  useLayoutEffect(() => {
    const el = replyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [replyDraft]);

  const effectivelyExpanded = focused;

  useEffect(() => {
    if (effectivelyExpanded) markSeen();
  }, [effectivelyExpanded, markSeen]);

  useEffect(() => {
    const prev = prevUnreadCountRef.current;
    prevUnreadCountRef.current = unreadCount;
    if (!(prev === 0 && unreadCount > 0)) return;
    if (effectivelyExpanded) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 1200);
    return () => clearTimeout(t);
  }, [unreadCount, effectivelyExpanded]);

  const sendReply = async () => {
    if (!replyDraft.trim()) return;
    setSubmitting(true);
    try {
      await api.createReply(comment.id, {
        payload: { text: replyDraft.trim() },
      });
      setReplyDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  const onReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void sendReply();
    }
  };

  const toggleResolve = async () => {
    if (resolving) return;
    // Resolving counts as acknowledgement — clear any pending unread badge so
    // the rail doesn't continue nagging about replies the Dev just dismissed.
    markSeen();
    setResolving(true);
    try {
      if (comment.resolved_by) await api.unresolveComment(comment.id);
      else await api.resolveComment(comment.id);
    } finally {
      setResolving(false);
    }
  };

  const resolved = comment.resolved_by !== null;
  const showUnread = unreadCount > 0 && !focused && !resolved;
  const baseBorder = focused
    ? 'border-2 border-accent'
    : showUnread
      ? 'border-highlight'
      : 'border-hairline';
  const border = `${baseBorder}${orphan ? ' border-dashed' : ''}`;
  const ringClass = pulsing ? ' ring-2 ring-accent/40 animate-pulse' : '';
  const shadowClass = focused ? ' shadow-card-elevated' : '';
  const firstReply = comment.replies[0];

  return (
    <div
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus?.();
        }
      }}
      role={onFocus ? 'button' : undefined}
      tabIndex={onFocus ? 0 : undefined}
      className={`border bg-surface-1 ${border}${ringClass}${shadowClass} cursor-pointer transition-[colors,box-shadow] ${
        effectivelyExpanded
          ? 'rounded-xl overflow-hidden'
          : 'rounded-lg shadow-1 hover:border-accent px-3 py-2.5'
      }`}
    >
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {showUnread ? `${unreadCount} unread ${unreadCount === 1 ? 'reply' : 'replies'}` : ''}
      </span>

      {effectivelyExpanded ? (
        <>
          <div
            className={`flex flex-col max-h-[33vh] overflow-y-auto pt-1.5 transition-opacity ${
              resolved ? 'opacity-50' : ''
            }`}
          >
            {comment.replies.map((r) => (
              <ReplyRow key={r.id} reply={r} />
            ))}
          </div>

          {resolved ? (
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
                  onClick={(e) => e.stopPropagation()}
                  rows={1}
                  className="text-body-sm min-h-0 resize-none overflow-hidden bg-surface-2 border-hairline rounded-lg px-3.5 py-2.5"
                />
              </div>
              <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-4">
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
                <Button
                  variant="accent"
                  size="md"
                  disabled={submitting || !replyDraft.trim()}
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
        </>
      ) : (
        <div className={`flex items-center gap-2.5 ${resolved ? 'opacity-60' : ''}`}>
          <span
            aria-hidden
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-subtle text-[10px] font-semibold uppercase text-on-primary"
          >
            {firstReply?.author === 'agent' ? 'A' : 'D'}
          </span>
          <span
            className={`text-micro-uppercase uppercase font-semibold ${
              firstReply?.author === 'agent' ? 'text-accent-deep' : 'text-ink-subtle'
            }`}
          >
            {firstReply?.author ?? 'dev'}
          </span>
          <span className="flex-1 min-w-0 truncate text-body-sm text-ink-muted">
            {firstReply ? previewText(firstReply.payload.text) : ''}
          </span>
          {comment.replies.length > 1 ? (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-surface-2 text-micro font-semibold text-ink-subtle tabular-nums">
              {comment.replies.length}
            </span>
          ) : null}
          <Tooltip content={resolved ? 'Reopen comment' : 'Resolve comment'}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void toggleResolve();
              }}
              aria-label={resolved ? 'Reopen comment' : 'Resolve comment'}
              disabled={resolving}
              className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft ${
                resolved
                  ? 'bg-accent text-on-accent'
                  : 'text-ink-subtle hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {resolving ? (
                <Loader2 className="size-icon-md animate-spin" aria-hidden />
              ) : (
                <Check className="size-icon-md" strokeWidth={2.3} aria-hidden />
              )}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// Compact preview is plain <span>, not MarkdownText. Strip leading list/heading/
// quote markers and inline emphasis chars so raw markdown doesn't bleed through.
function previewText(text: string): string {
  const firstNonEmpty = text.split('\n').find((l) => l.trim()) ?? '';
  return firstNonEmpty
    .replace(/^[\s>#*\-+]+/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

function formatReplyTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function ReplyRow({ reply }: { reply: Reply }) {
  const [showMore, setShowMore] = useState(false);
  // Latches once we observe real overflow against the line-clamp. Char-count
  // heuristics misfire on markdown source (false positives on short replies
  // with leading syntax, false negatives on tall replies with many short
  // paragraphs); only the rendered layout knows.
  const [clampable, setClampable] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (showMore) return;
    const el = bodyRef.current;
    if (!el) return;
    const check = () => {
      if (el.scrollHeight > el.clientHeight + 1) setClampable(true);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showMore]);

  const clamped = clampable && !showMore;
  return (
    <div className="px-4 py-2.5 border-t border-hairline-soft first:border-t-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          aria-hidden
          className={`size-[7px] rounded-full ${
            reply.author === 'agent' ? 'bg-accent' : 'bg-ink-subtle'
          }`}
        />
        <span
          className={`text-micro-uppercase uppercase font-semibold ${
            reply.author === 'agent' ? 'text-accent-deep' : 'text-ink-subtle'
          }`}
        >
          {reply.author}
        </span>
        <span className="text-caption text-ink-tertiary tabular-nums">
          {`· ${formatReplyTime(reply.created_at)}`}
        </span>
      </div>
      <div ref={bodyRef} className={clamped ? 'line-clamp-4' : undefined}>
        <MarkdownText text={reply.payload.text} className="[&_p]:text-body-sm" />
      </div>
      {clampable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMore((v) => !v);
          }}
          className="mt-1 text-micro text-accent-hover hover:underline"
        >
          {showMore ? 'Show less' : 'Show more…'}
        </button>
      ) : null}
    </div>
  );
}
