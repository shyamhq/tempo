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
      await api.createReply(c.id, { payload: { type: 'text', text: draft.trim() } });
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
        payload: { type: 'text', text: replyDraft.trim() },
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
              ? 'flex-1 truncate text-[10px] uppercase tracking-wider text-ink-tertiary self-center'
              : 'flex-1 truncate text-[13px] italic text-ink-subtle self-center'
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
            <Badge tone="accent" aria-hidden className="h-5 px-2 text-[10px]">
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
  const isEditProposed = reply.payload.type === 'edit_proposed';
  const isEditDone = reply.payload.type === 'edit_done';
  // Boxed treatment is reserved for rows with structured affordances (edit
  // proposals, applied edits). Plain text replies read better as transcript.
  const boxed = isEditProposed || isEditDone;

  const decide = async (decision: 'accepted' | 'rejected') => {
    await api.decideProposal(reply.id, { decision });
  };

  const text = reply.payload.text;

  const containerClass = boxed
    ? 'my-2 first:mt-0 last:mb-0 rounded border border-hairline bg-surface-2 p-2'
    : 'py-2 first:pt-0 border-t border-hairline first:border-t-0';

  return (
    <div className={containerClass}>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${
            reply.author === 'agent' ? 'text-[#069072]' : 'text-ink-subtle'
          }`}
        >
          <span aria-hidden className="size-[5px] rounded-full bg-current" />
          {reply.author}
        </span>
        <span className="text-[11px] text-ink-tertiary tabular-nums">
          {`· ${formatReplyTime(reply.created_at)}`}
        </span>
        {isEditProposed ? (
          <span className="text-[10px] text-accent-hover">proposed edit</span>
        ) : null}
        {isEditDone ? <span className="text-[10px] text-success">edit applied</span> : null}
      </div>
      <div ref={bodyRef} className={clamp ? 'line-clamp-3' : undefined}>
        <MarkdownText text={text} />
      </div>
      {isEditProposed && reply.payload.type === 'edit_proposed' ? (
        <div className="mt-2 rounded border border-hairline bg-surface-3 p-2 text-[11px] font-mono text-ink-muted whitespace-pre-wrap">
          {reply.payload.replacement}
        </div>
      ) : null}
      {isEditProposed && reply.proposal_status === null ? (
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void decide('accepted');
            }}
          >
            Approve edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void decide('rejected');
            }}
          >
            Reject
          </Button>
        </div>
      ) : null}
      {reply.proposal_status === 'accepted' ? (
        <p className="mt-1 text-[10px] text-success">Accepted</p>
      ) : reply.proposal_status === 'rejected' ? (
        <p className="mt-1 text-[10px] text-ink-tertiary">
          Rejected{reply.rejection_reason ? `: ${reply.rejection_reason}` : ''}
        </p>
      ) : null}
    </div>
  );
}
