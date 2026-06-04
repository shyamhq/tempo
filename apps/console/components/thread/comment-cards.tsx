'use client';

import type { Comment, Reply } from '@tempo/contracts';
import { Check, CheckCheck } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUnreadAgentReplies } from '@/hooks/use-unread-agent-replies';
import { api } from '@/lib/api-client';
import { useComposerStore } from '@/lib/stores/composer-store';
import { MarkdownText } from './markdown-text';

export function NewCommentCard({ threadId }: { threadId: string }) {
  const { plan_quote, plan_context, draft, setDraft, cancel, setLastCreated } = useComposerStore();
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const submit = async () => {
    if (!draft.trim()) return;
    setPhase('sending');
    try {
      const c = await api.createComment(threadId, { plan_quote, plan_context });
      await api.createReply(c.id, { payload: { text: draft.trim() } });
      setLastCreated(c.id);
      setPhase('sent');
      closeTimerRef.current = setTimeout(() => cancel(), 700);
    } catch {
      setPhase('idle');
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

  let submitLabel: React.ReactNode;
  switch (phase) {
    case 'sending':
      submitLabel = 'Sending…';
      break;
    case 'sent':
      submitLabel = (
        <span className="inline-flex items-center gap-1">
          <Check className="size-3" aria-hidden /> Sent
        </span>
      );
      break;
    default:
      submitLabel = 'Comment';
  }

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
        <Button variant="ghost" size="sm" onClick={cancel} disabled={phase !== 'idle'}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={phase !== 'idle' || !draft.trim()}
          onClick={submit}
        >
          {submitLabel}
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
  const [expanded, setExpanded] = useState(false);
  const [firstReplyOverflows, setFirstReplyOverflows] = useState(false);
  const firstReplyRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!focused) setExpanded(false);
  }, [focused]);

  const effectivelyExpanded = focused || expanded;

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

  useLayoutEffect(() => {
    if (effectivelyExpanded) return;
    const el = firstReplyRef.current;
    if (!el) return;
    const check = () => setFirstReplyOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectivelyExpanded, comment.replies]);

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
    // Resolving counts as acknowledgement — clear any pending unread badge so
    // the rail doesn't continue nagging about replies the Dev just dismissed.
    markSeen();
    if (comment.resolved_by) await api.unresolveComment(comment.id);
    else await api.resolveComment(comment.id);
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
  const extraReplyCount = Math.max(0, comment.replies.length - 1);
  const showMoreVisible = !effectivelyExpanded && (firstReplyOverflows || extraReplyCount > 0);

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
      className={`rounded-md border bg-surface-1 ${border}${ringClass}${shadowClass} p-3 cursor-pointer transition-[colors,box-shadow]`}
    >
      <div className="mb-2 flex items-stretch gap-2">
        {!orphan && comment.plan_quote ? (
          <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-accent" />
        ) : null}
        <span
          className={
            orphan
              ? 'flex-1 truncate text-micro font-normal uppercase tracking-uppercase text-ink-tertiary self-center'
              : 'flex-1 truncate text-caption italic text-ink-subtle self-center'
          }
          title={!orphan && comment.plan_quote ? comment.plan_quote : undefined}
        >
          {orphan ? 'No matching Plan text' : `“${comment.plan_quote}”`}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 self-center">
          {/* Always-mounted live region so screen readers announce on arrival
              of the first unread reply; the visible Badge below is purely visual. */}
          <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {showUnread ? `${unreadCount} unread ${unreadCount === 1 ? 'reply' : 'replies'}` : ''}
          </span>
          {showUnread ? (
            <Badge tone="accent" aria-hidden className="h-5 px-2 text-micro font-normal">
              {unreadCount} new
            </Badge>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void toggleResolve();
            }}
            aria-label={resolved ? 'Unresolve' : 'Resolve'}
            title={resolved ? 'Unresolve' : 'Resolve'}
            className="rounded p-0.5 text-ink-tertiary hover:bg-surface-2 hover:text-ink-secondary"
          >
            {resolved ? (
              <CheckCheck className="size-3.5 text-success" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {effectivelyExpanded ? (
        <div className="flex flex-col">
          {comment.replies.map((r) => (
            <ReplyRow key={r.id} reply={r} />
          ))}
        </div>
      ) : firstReply ? (
        <div className="flex flex-col">
          <ReplyRow reply={firstReply} bodyRef={firstReplyRef} clamp />
        </div>
      ) : null}

      {showMoreVisible ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="mt-2 text-xs text-accent-hover hover:underline"
        >
          Show more
          {extraReplyCount > 0
            ? ` (${extraReplyCount} ${extraReplyCount === 1 ? 'reply' : 'replies'})`
            : ''}
        </button>
      ) : null}

      {effectivelyExpanded && !resolved ? (
        <div className="mt-2">
          <Textarea
            ref={replyRef}
            placeholder="Reply…"
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={onReplyKeyDown}
            onClick={(e) => e.stopPropagation()}
            rows={1}
            className="text-xs min-h-0 resize-none overflow-hidden"
          />
          <div className="mt-2 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              disabled={submitting || !replyDraft.trim()}
              onClick={(e) => {
                e.stopPropagation();
                void sendReply();
              }}
            >
              Reply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatReplyTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function ReplyRow({
  reply,
  bodyRef,
  clamp = false,
}: {
  reply: Reply;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  clamp?: boolean;
}) {
  return (
    <div className="py-2 first:pt-0 border-t border-hairline first:border-t-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={`inline-flex items-center gap-1.5 text-micro-uppercase uppercase ${
            reply.author === 'agent' ? 'text-accent-deep' : 'text-ink-subtle'
          }`}
        >
          <span aria-hidden className="size-[5px] rounded-full bg-current" />
          {reply.author}
        </span>
        <span className="text-micro font-normal text-ink-tertiary tabular-nums">
          {`· ${formatReplyTime(reply.created_at)}`}
        </span>
      </div>
      <div ref={bodyRef} className={clamp ? 'line-clamp-3' : undefined}>
        <MarkdownText text={reply.payload.text} />
      </div>
    </div>
  );
}
